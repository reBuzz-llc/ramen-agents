// Run: npm test. The owner's Pause / Resume / Stop / Start (2026-10-31) on a fixture workspace with
// a fake scripts folder (each script prints a line and leaves a marker; nothing touches launchd), and the confirm text.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-ignore TS5097
import { control, pauseUntil } from "../lib/owner-controls.ts";
// @ts-ignore TS5097
import { confirmText } from "../lib/world.ts";

const NOW = new Date(2026, 9, 31, 14, 0, 0).getTime();
const has = (p: string) => stat(p).then(() => true, () => false);

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "controls-"));
  const ws = path.join(root, "bots", "lead-gen", "workspace");
  const scripts = path.join(root, "scripts");
  await mkdir(ws, { recursive: true });
  await mkdir(scripts, { recursive: true });
  for (const [name, says] of [
    ["disable-bot.sh", "com.ramen-agents.bot.$1(unloaded, disabled)"],
    ["enable-bot.sh", "com.ramen-agents.bot.$1(loaded)"],
    ["restart-bot.sh", "exited on STOP; restarted (run loop + data server)"],
  ])
    await writeFile(path.join(scripts, name), `#!/bin/sh\necho "$1: ${says}"\ntouch "${root}/ran-${name}"\n`);
  const agents = path.join(root, "LaunchAgents");
  await mkdir(agents, { recursive: true });
  return { root, ws, ctx: { slug: "lead-gen", ws, scripts, agents, log: path.join(root, "owner-controls.jsonl"), who: "Owner", now: NOW, alive: async () => true } };
}

test("pause writes PAUSE as the bare time it ends, who and why go to the log; resume removes it", async () => {
  const { ws, ctx } = await fixture();
  const r = await control(ctx, "pause", { choice: "2h", reason: "  too many repeats  " });
  assert.equal(r.ok, true);
  assert.equal(r.until, "2026-10-31T16:00");
  assert.equal(r.text, "Paused until 10-31 16:00.");
  // the engine's format: the bare local time as the file's whole text
  assert.equal(await readFile(path.join(ws, "PAUSE"), "utf8"), "2026-10-31T16:00");
  assert.equal((await control(ctx, "resume")).ok, true);
  assert.equal(await has(path.join(ws, "PAUSE")), false);
  const log = (await readFile(ctx.log, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(
    log.map((l: { action: string; reason: string; ts: string }) => [l.action, l.reason, l.ts]),
    [
      ["pause", "too many repeats", "2026-10-31T14:00:00"],
      ["resume", "", "2026-10-31T14:00:00"],
    ],
  );
  assert.equal(log[0].who, "Owner");
  assert.equal(log[0].bot, "lead-gen");
});

test("stop writes STOP and runs disable-bot.sh; start removes STOP, runs enable-bot.sh then restart-bot.sh; result is their output", async () => {
  const { root, ws, ctx } = await fixture();
  const s = await control(ctx, "stop", { reason: "send it home" });
  assert.equal(s.ok, true);
  assert.equal(await has(path.join(ws, "STOP")), true);
  assert.equal(await has(path.join(root, "ran-disable-bot.sh")), true);
  assert.match(s.text, /^STOP written\. lead-gen: com\.ramen-agents\.bot\.lead-gen\(unloaded, disabled\)$/);
  const st = await control(ctx, "start", { reason: "back to work" });
  assert.equal(st.ok, true);
  assert.equal(await has(path.join(ws, "STOP")), false);
  assert.equal(await has(path.join(root, "ran-enable-bot.sh")), true);
  assert.equal(await has(path.join(root, "ran-restart-bot.sh")), true);
  assert.equal(st.text, "lead-gen: com.ramen-agents.bot.lead-gen(loaded) · lead-gen: exited on STOP; restarted (run loop + data server) · run loop alive");
  assert.deepEqual(await control(ctx, "start"), { ok: false, text: "It is not stopped." });
  const log = (await readFile(ctx.log, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(log.map((l: { action: string; ok: boolean }) => [l.action, l.ok]), [["stop", true], ["start", true], ["start", false]]);
});

test("a failing script is reported, not hidden", async () => {
  const { ctx } = await fixture();
  await writeFile(path.join(ctx.scripts, "disable-bot.sh"), '#!/bin/sh\necho "$1: no STOP file, refused" >&2\nexit 1\n');
  const r = await control(ctx, "stop");
  assert.equal(r.ok, false);
  assert.match(r.text, /no STOP file, refused/);
});

test("confirm flow: the question first, the pause end times", () => {
  assert.equal(confirmText("stop", "Lead Gen"), "Send Lead Gen home? It stops until you start it again.");
  assert.equal(confirmText("pause", "Lead Gen", "30m"), "Pause Lead Gen for 30 minutes?");
  assert.equal(confirmText("pause", "Lead Gen", "tomorrow"), "Pause Lead Gen until tomorrow morning?");
  assert.equal(confirmText("start", "Scout"), "Wake Scout and bring it back to its desk?");
  assert.equal(confirmText("resume", "Lead Gen"), "Let Lead Gen get back to work now?");
  assert.equal(pauseUntil("30m", NOW), "2026-10-31T14:30:00");
  assert.equal(pauseUntil("tomorrow", NOW), "2026-11-01T07:00:00");
});

test("start says it did not start, and puts STOP back, with no launch agents or no loop after the restart", async () => {
  const { ws, ctx } = await fixture();
  await writeFile(path.join(ws, "STOP"), "");
  await writeFile(path.join(ctx.scripts, "enable-bot.sh"), '#!/bin/sh\necho "$1: no plists found"\n');
  const a = await control(ctx, "start");
  assert.equal(a.ok, false);
  assert.match(a.text, /^did not start: it has no launch agents/);
  assert.equal(await has(path.join(ws, "STOP")), true);
  await writeFile(path.join(ctx.scripts, "enable-bot.sh"), '#!/bin/sh\necho "$1: com.ramen-agents.bot.$1(loaded)"\n');
  const b = await control({ ...ctx, alive: async () => false }, "start");
  assert.equal(b.ok, false);
  assert.match(b.text, /^did not start: no run loop is running after the restart/);
  assert.equal(await has(path.join(ws, "STOP")), true);
});

test("a retired bot: Start refused, Bring back recreates its launch agents from another bot's and starts it", async () => {
  const { root, ws, ctx } = await fixture();
  const job = { ...ctx, slug: "jobless-bot" };
  await writeFile(path.join(ws, "..", "RETIRED.md"), "# retired 2026-09-25 (owner)\n");
  await writeFile(path.join(ws, "STOP"), "");
  assert.deepEqual(await control(job, "start"), { ok: false, text: "It is retired: use Bring back." });
  // no template yet: refused with the reason
  const none = await control(job, "bringback");
  assert.equal(none.ok, false);
  assert.match(none.text, /no other bot's launch agents to copy from/);
  for (const kind of ["bot", "data"])
    await writeFile(path.join(ctx.agents, `com.ramen-agents.${kind}.lead-gen.plist`), `<string>com.ramen-agents.${kind}.lead-gen</string><string>/Users/x/bots/lead-gen/config.toml</string>`);
  const r = await control(job, "bringback", { reason: "owner wants it back" });
  assert.equal(r.ok, true, r.text);
  assert.match(r.text, /^recreated com\.ramen-agents\.bot\.jobless-bot\.plist, com\.ramen-agents\.data\.jobless-bot\.plist from lead-gen's\./);
  assert.equal(await readFile(path.join(ctx.agents, "com.ramen-agents.bot.jobless-bot.plist"), "utf8"), "<string>com.ramen-agents.bot.jobless-bot</string><string>/Users/x/bots/jobless-bot/config.toml</string>");
  assert.equal(await has(path.join(ws, "..", "RETIRED.md")), false);
  assert.equal(await has(path.join(ws, "..", "RETIRED-until-2026-10-31.md")), true);
  assert.equal(await has(path.join(root, "ran-restart-bot.sh")), true);
});
