// The owner's hand on each bot, from the world's text box (2026-10-31): pause for a while, stop
// (send it home), start again. Every action is asked first in the box and logged to
// common-data/shared-state/owner-controls.jsonl {who, bot, action, reason, ts, result}.
//   pause:  workspace/PAUSE holds the local time it ends, bare ("2026-10-31T09:30"): the engine (889a604) pauses until
//           then and simply stops pausing after (the file stays); "by" and the reason go to the log only.
//   resume: removes PAUSE.
//   stop:   workspace/STOP, then scripts/disable-bot.sh <slug> so launchd stops relaunching it.
//   start:  removes STOP, then scripts/enable-bot.sh <slug> and scripts/restart-bot.sh <slug>; then checks that a run
//           loop is alive. With no launch agents, or no loop after the restart, it says "did not start: <reason>" and
//           puts STOP back (10-30: Start on the retired jobless-bot reported ok with nothing running).
//   bringback: a retired bot (RETIRED.md): recreates its two launch agents from another bot's (the label and folder
//           swapped, as RETIRED.md says), sets RETIRED.md aside, then starts it as above.
// The scripts' own output is the result line. Node imports only, so the test runs it on a fixture workspace with a
// fake scripts folder.
import { execFile } from "node:child_process";
import { appendFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

// The same two types as lib/world.ts (the box's confirm text lives there, with no Node imports, for the browser).
export type Action = "pause" | "resume" | "stop" | "start" | "bringback";
export type PauseFor = "30m" | "2h" | "tomorrow";
type Result = { ok: boolean; text: string };

function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** When a pause ends: in 30 minutes, in 2 hours, or tomorrow at 07:00. */
export function pauseUntil(choice: PauseFor, now: number): string {
  if (choice === "30m") return localIso(now + 30 * 60e3);
  if (choice === "2h") return localIso(now + 2 * 3600e3);
  const d = new Date(now);
  return localIso(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 7, 0, 0).getTime());
}

const exists = (p: string) => stat(p).then(() => true, () => false);

async function script(scripts: string, name: string, slug: string, timeoutMs: number): Promise<Result> {
  try {
    const { stdout, stderr } = await run("/bin/sh", [path.join(scripts, name), slug], { timeout: timeoutMs, maxBuffer: 1 << 20 });
    return { ok: true, text: `${stdout}${stderr}`.trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, text: `${e.stdout ?? ""}${e.stderr ?? ""}`.trim() || (e.message ?? "the script failed") };
  }
}

type Ctx = {
  slug: string;
  ws: string;
  scripts: string;
  log: string;
  who: string;
  now?: number;
  agents?: string; // ~/Library/LaunchAgents (a folder of fakes in the tests)
  alive?: (slug: string) => Promise<boolean>; // is its run loop running (pgrep in real use)
};

/** Whether the bot's run loop is running, asked a few times over `waitMs` (a restart takes a few seconds). */
async function loopAlive(ctx: Ctx, waitMs: number): Promise<boolean> {
  const check =
    ctx.alive ??
    ((slug: string) =>
      run("/usr/bin/pgrep", ["-f", `bots/${slug}/config.toml run`]).then(
        () => true,
        () => false,
      ));
  const end = Date.now() + waitMs;
  for (;;) {
    if (await check(ctx.slug)) return true;
    if (Date.now() >= end) return false;
    await new Promise((r) => setTimeout(r, 1000));
  }
}

const TEMPLATE_BOTS = ["lead-gen", "research-analyst", "package-designer", "lead-enricher", "outreach-writer", "the-ceo", "scout", "onion-reader"];

/** Recreate a retired bot's two launch agents from another bot's: the label and folder swapped. The plists stay unloaded
 *  (enable-bot.sh loads them). Throws a plain reason when no template is found. */
async function recreateAgents(ctx: Ctx): Promise<string> {
  const dir = ctx.agents ?? path.join(process.env.HOME ?? "", "Library", "LaunchAgents");
  const have = new Set(await readdir(dir).catch(() => [] as string[]));
  const src = TEMPLATE_BOTS.find((b) => b !== ctx.slug && have.has(`com.ramen-agents.bot.${b}.plist`) && have.has(`com.ramen-agents.data.${b}.plist`));
  if (!src) throw new Error("no other bot's launch agents to copy from");
  const made: string[] = [];
  for (const kind of ["bot", "data"]) {
    const target = path.join(dir, `com.ramen-agents.${kind}.${ctx.slug}.plist`);
    if (have.has(path.basename(target))) continue;
    const text = (await readFile(path.join(dir, `com.ramen-agents.${kind}.${src}.plist`), "utf8"))
      .split(`com.ramen-agents.bot.${src}`).join(`com.ramen-agents.bot.${ctx.slug}`)
      .split(`com.ramen-agents.data.${src}`).join(`com.ramen-agents.data.${ctx.slug}`)
      .split(`/bots/${src}/`).join(`/bots/${ctx.slug}/`);
    if (text.includes(`/bots/${src}/`) || !text.includes(`/bots/${ctx.slug}/`)) throw new Error(`the copy of ${src}'s ${kind} plist still names ${src}`);
    await writeFile(target, text);
    made.push(path.basename(target));
  }
  return made.length ? `recreated ${made.join(", ")} from ${src}'s` : "launch agents already there";
}

/** Start: remove STOP, enable, restart, then check the loop; on failure put STOP back and say why. */
async function start(ctx: Ctx): Promise<Result> {
  const stop = path.join(ctx.ws, "STOP");
  await rm(stop, { force: true });
  const e = await script(ctx.scripts, "enable-bot.sh", ctx.slug, 30_000);
  const fail = async (why: string, more = ""): Promise<Result> => {
    await writeFile(stop, "");
    return { ok: false, text: `did not start: ${why}. STOP put back.${more ? ` ${more}` : ""}` };
  };
  if (!e.ok) return fail("enable-bot.sh failed", e.text);
  if (/no plists found/.test(e.text)) return fail(`it has no launch agents (no com.ramen-agents.bot.${ctx.slug} plist)`);
  // restart-bot.sh waits up to 120 s for a loop to exit, then 15 s more: give it the time
  const r = await script(ctx.scripts, "restart-bot.sh", ctx.slug, 160_000);
  if (!r.ok) return fail("restart-bot.sh failed", r.text);
  if (!(await loopAlive(ctx, 12_000))) return fail("no run loop is running after the restart", [e.text, r.text].join(" · "));
  return { ok: true, text: [e.text, r.text, "run loop alive"].filter(Boolean).join(" · ") };
}

/** Do one action and log it; the result line is what happened (the scripts' output for stop and start). */
export async function control(ctx: Ctx, action: Action, opts: { choice?: PauseFor; reason?: string } = {}): Promise<Result & { until?: string }> {
  const now = ctx.now ?? Date.now();
  const reason = (opts.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
  let res: Result & { until?: string };
  if (action === "pause") {
    const until = pauseUntil(opts.choice ?? "2h", now).slice(0, 16);
    await writeFile(path.join(ctx.ws, "PAUSE"), until);
    res = { ok: true, text: `Paused until ${until.replace("T", " ").slice(5, 16)}.`, until };
  } else if (action === "resume") {
    await rm(path.join(ctx.ws, "PAUSE"), { force: true });
    res = { ok: true, text: "Pause lifted; it picks up on its next step." };
  } else if (action === "stop") {
    await writeFile(path.join(ctx.ws, "STOP"), "");
    const d = await script(ctx.scripts, "disable-bot.sh", ctx.slug, 30_000);
    res = { ok: d.ok, text: `STOP written. ${d.text}`.trim() };
  } else if (action === "start") {
    if (await exists(path.join(ctx.ws, "..", "RETIRED.md"))) res = { ok: false, text: "It is retired: use Bring back." };
    else if (!(await exists(path.join(ctx.ws, "STOP")))) res = { ok: false, text: "It is not stopped." };
    else res = await start(ctx);
  } else {
    // bring back a retired bot
    const retired = path.join(ctx.ws, "..", "RETIRED.md");
    if (!(await exists(retired))) res = { ok: false, text: "It is not retired." };
    else {
      try {
        const made = await recreateAgents(ctx);
        await writeFile(path.join(ctx.ws, "STOP"), ""); // start() removes it again
        const st = await start(ctx);
        if (st.ok) await rename(retired, path.join(ctx.ws, "..", `RETIRED-until-${localIso(now).slice(0, 10)}.md`));
        res = { ok: st.ok, text: `${made}. ${st.text}` };
      } catch (err) {
        res = { ok: false, text: `did not bring it back: ${err instanceof Error ? err.message : String(err)}` };
      }
    }
  }
  await mkdir(path.dirname(ctx.log), { recursive: true });
  await appendFile(ctx.log, JSON.stringify({ who: ctx.who, bot: ctx.slug, action, ...(opts.choice && action === "pause" ? { for: opts.choice } : {}), reason, ts: localIso(now), ok: res.ok, result: res.text.slice(0, 500) }) + "\n");
  return res;
}
