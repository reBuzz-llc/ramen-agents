// Server-side only: start and stop a bot. These are the same levers the bot's own CLI pulls.
//
// Stop writes the STOP file (`bot stop`). The agent notices within a second and exits 0; under launchd,
// scripts/supervise.sh then exits 0 and KeepAlive leaves it down.
// Run clears STOP and PAUSE (`bot resume`) and starts the agent: through launchd when the bot has a
// launch agent (`bot install`), so it keeps its supervisor and restarts, or as a detached
// `bot --config <config> run --quiet` for a bot that is run by hand. A desktop bot (the Desk Agent) is never run by
// hand: only its Mac app's launch agent may start it.
import { execFile, spawn } from "node:child_process";
import { mkdir, open, readdir, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { BotProfile } from "./bot";
import { CODE_ROOT, readConfig } from "./bots";
import { agentPids } from "./processes";

export { agentPids };

const run = promisify(execFile);
const LABEL_PREFIX = "com.rebuzz.bot.";

export type ControlOp = "run" | "stop" | "restart";
export type ControlResult = { ok: boolean; note: string; how?: "launchd" | "manual" };

async function exists(p: string): Promise<boolean> {
  try {
    await stat(/*turbopackIgnore: true*/ p);
    return true;
  } catch {
    return false;
  }
}

/** The bot's workspace folder: [paths] workspace, relative to the config file (src/explorer/config.py). */
export async function workspaceDir(bot: BotProfile): Promise<string> {
  let rel = "workspace";
  try {
    const v = (await readConfig(bot.configPath)).get("paths.workspace");
    if (typeof v === "string" && v.trim()) rel = v;
  } catch {
    /* default */
  }
  return path.resolve(path.dirname(bot.configPath), rel.replace(/^~(?=\/)/, homedir()));
}

export async function flags(bot: BotProfile): Promise<string[]> {
  const ws = await workspaceDir(bot);
  const out: string[] = [];
  if (await exists(path.join(ws, "PAUSE"))) out.push("PAUSE");
  if (await exists(path.join(ws, "STOP"))) out.push("STOP");
  return out;
}

// The Desk Agent drives the screen, and macOS grants Accessibility to the signed rebuzzBot.app bundle, not to a venv
// Python: it runs ONLY as that app, under this launch agent. A `bot ... run` started beside it has no GUI permission
// and takes the pid lock, so the real app exits 3 on every start (owner's dashboard, 2026-09-25 21:09).
// The app was renamed rebuzzBot.app -> Desk Agent.app (owner, 2026-09-25); the old label is the fallback until the
// new one is installed.
const DESKTOP_APP_LABELS = ["com.rebuzz.desk-agent-app", "com.rebuzz.rebuzzbot"];

/** True for a bot whose config enables [desktop]: it may only be started through its app's launch agent. */
async function isDesktopBot(bot: BotProfile): Promise<boolean> {
  try {
    return (await readConfig(bot.configPath)).get("desktop.enabled") === true;
  } catch {
    return false;
  }
}

/** The launch agent whose EXPLORER_CONFIG is this bot's config, as `bot install` writes it; for a desktop bot, the
 * rebuzzBot.app agent. */
export async function launchAgent(bot: BotProfile): Promise<{ label: string; plist: string } | null> {
  if (process.platform !== "darwin") return null;
  const dir = path.join(homedir(), "Library", "LaunchAgents");
  if (await isDesktopBot(bot)) {
    // The first installed agent whose app is on disk: during the rename the new plist can land before the new app.
    for (const label of DESKTOP_APP_LABELS) {
      const plist = path.join(dir, `${label}.plist`);
      try {
        const { stdout } = await run("/usr/bin/plutil", ["-extract", "ProgramArguments.0", "raw", plist], { timeout: 3000 });
        if (await exists(stdout.trim())) return { label, plist };
      } catch {
        /* no plist under this label */
      }
    }
    return null;
  }
  let files: string[];
  try {
    files = (await readdir(/*turbopackIgnore: true*/ dir)).filter((f) => f.startsWith(LABEL_PREFIX) && f.endsWith(".plist"));
  } catch {
    return null;
  }
  for (const file of files) {
    const plist = path.join(dir, file);
    try {
      const { stdout } = await run("/usr/bin/plutil", ["-convert", "json", "-o", "-", plist], { timeout: 3000 });
      const data = JSON.parse(stdout) as { Label?: string; EnvironmentVariables?: Record<string, string> };
      const cfg = data.EnvironmentVariables?.EXPLORER_CONFIG;
      if (cfg && path.resolve(cfg) === path.resolve(bot.configPath)) {
        return { label: data.Label ?? file.replace(/\.plist$/, ""), plist };
      }
    } catch {
      /* unreadable plist: not ours */
    }
  }
  return null;
}

// How long Run waits for a bot that was told to stop (restart-bot.sh waits 45 s): a step can outlast a short wait.
const STOP_WAIT_MS = 60000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(check: () => Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    if (await check()) return true;
    await sleep(500);
  }
  return check();
}

async function launchctl(...args: string[]): Promise<{ code: number; out: string }> {
  try {
    const { stdout, stderr } = await run("/bin/launchctl", args, { timeout: 10000 });
    return { code: 0, out: `${stdout}${stderr}`.trim() };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string; message?: string };
    return { code: typeof e.code === "number" ? e.code : 1, out: `${e.stdout ?? ""}${e.stderr ?? e.message ?? ""}`.trim() };
  }
}

export async function stopBot(bot: BotProfile): Promise<ControlResult> {
  const ws = await workspaceDir(bot);
  await mkdir(/*turbopackIgnore: true*/ ws, { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ path.join(ws, "STOP"), "");
  const stopped = await waitFor(async () => (await agentPids(bot.configPath, path.join(await workspaceDir(bot), "explorer.pid"))).length === 0, 6000);
  return stopped
    ? { ok: true, note: `${bot.name} stopped. It stays down until you press Run.` }
    : { ok: true, note: `Stop requested. ${bot.name} exits as soon as it finishes its current step.` };
}

export async function runBot(bot: BotProfile): Promise<ControlResult> {
  const ws = await workspaceDir(bot);
  const stopFile = path.join(ws, "STOP");
  const hadStop = await exists(stopFile);

  // A bot that was just told to stop may still be finishing its step (a local-model call can take a minute).
  // Removing STOP now would let it carry on with the old persona, or exit later and stay down: wait, and if it is
  // still going, leave STOP in place and say so rather than claim a start.
  if (hadStop && (await agentPids(bot.configPath, path.join(await workspaceDir(bot), "explorer.pid"))).length > 0) {
    const gone = await waitFor(async () => (await agentPids(bot.configPath, path.join(await workspaceDir(bot), "explorer.pid"))).length === 0, STOP_WAIT_MS);
    if (!gone) {
      return { ok: false, note: `${bot.name} is still finishing its current step and has not stopped yet. It will stop on its own; press Run once it shows as stopped.` };
    }
  }
  await rm(/*turbopackIgnore: true*/ stopFile, { force: true });
  await rm(/*turbopackIgnore: true*/ path.join(ws, "PAUSE"), { force: true });

  if ((await agentPids(bot.configPath, path.join(await workspaceDir(bot), "explorer.pid"))).length > 0) {
    return { ok: true, note: `${bot.name} is already running.` };
  }

  const agent = await launchAgent(bot);
  if (agent) {
    const uid = String(process.getuid?.() ?? "");
    const target = `gui/${uid}/${agent.label}`;
    const jobRunning = async () => /^\s*state = running\b/m.test((await launchctl("print", target)).out);
    const loaded = (await launchctl("print", target)).code === 0;
    let res;
    // For the Desk Agent the launchd job IS the agent (no supervisor): a running job is a running app that has not
    // taken its lock yet (waiting on a permission prompt, say). Never -k it; that would kill the live app.
    if (loaded && (await isDesktopBot(bot)) && (await jobRunning())) {
      return { ok: true, note: `${bot.name} is already running (its app is starting up).`, how: "launchd" };
    }
    if (loaded) {
      // After a stop the agent exits first and supervise.sh a moment later; launchd refuses to kickstart a job
      // it still counts as running. Wait for the supervisor to go, and if it lingers with no agent under it,
      // replace it (-k), which is safe because no agent is running.
      const idle = await waitFor(async () => !(await jobRunning()), 10000);
      res = await launchctl("kickstart", ...(idle ? [] : ["-k"]), target);
    } else {
      res = await launchctl("bootstrap", `gui/${uid}`, agent.plist);
    }
    if (res.code !== 0 && loaded && (await agentPids(bot.configPath, path.join(ws, "explorer.pid"))).length === 0) {
      // A job that exited inside its ThrottleInterval (30 s in the plist) sits in "spawn scheduled", and a plain
      // kickstart fails until then. -k forces the start; failing that, launchd starts it when the throttle ends.
      res = await launchctl("kickstart", "-k", target);
      if (res.code !== 0 && /^\s*state = (spawn scheduled|running)\b/m.test((await launchctl("print", target)).out)) {
        res = { code: 0, out: "" };
      }
    }
    if (res.code !== 0) {
      return { ok: false, note: `launchctl ${loaded ? "kickstart" : "bootstrap"} failed: ${res.out || `exit ${res.code}`}`, how: "launchd" };
    }
  } else if (await isDesktopBot(bot)) {
    return {
      ok: false,
      note: `${bot.name} runs only as its Mac app (it needs the app's Accessibility permission), and its launch agent ${DESKTOP_APP_LABELS[0]} is not installed.`,
    };
  } else {
    const botCli = path.join(CODE_ROOT, ".venv", "bin", "bot");
    if (!(await exists(botCli))) {
      return { ok: false, note: `The bot command was not found at ${botCli}. Set BOT_CODE_ROOT to the bot checkout.` };
    }
    const logDir = path.join(ws, "logs");
    await mkdir(/*turbopackIgnore: true*/ logDir, { recursive: true });
    const log = await open(/*turbopackIgnore: true*/ path.join(logDir, "manual.out"), "a");
    try {
      const child = spawn(botCli, ["--config", bot.configPath, "run", "--quiet"], {
        cwd: CODE_ROOT,
        detached: true,
        stdio: ["ignore", log.fd, log.fd],
        env: { ...process.env, PATH: `${path.join(homedir(), ".local", "bin")}:/usr/local/bin:/usr/bin:/bin:${process.env.PATH ?? ""}` },
      });
      // An 'error' event with no listener is an uncaught exception that takes down the whole server (a venv whose
      // interpreter was removed by a Python upgrade still has bin/bot, so the exists() check above passes).
      const failed = await new Promise<Error | null>((resolve) => {
        child.once("spawn", () => resolve(null));
        child.once("error", (err) => resolve(err));
      });
      if (failed) return { ok: false, note: `${bot.name} could not be started: ${failed.message}`, how: "manual" };
      child.unref();
    } finally {
      await log.close();
    }
  }

  // launchd may hold the start until the job's 30 s throttle interval has passed.
  const started = await waitFor(async () => (await agentPids(bot.configPath, path.join(await workspaceDir(bot), "explorer.pid"))).length > 0, agent ? 40000 : 8000);
  const how = agent ? "launchd" : "manual";
  if (!started) {
    const where = agent ? "workspace/logs/launchd.err.log" : "workspace/logs/manual.out";
    return { ok: false, note: `${bot.name} did not start. Check ${where} in its folder.`, how };
  }
  return {
    ok: true,
    note: agent ? `${bot.name} started through its launch agent.` : `${bot.name} started. It has no launch agent, so it will not restart after a crash.`,
    how,
  };
}

/** Stop, then run: how a bot picks up a new persona or bio, which it reads only when it starts. */
export async function restartBot(bot: BotProfile): Promise<ControlResult> {
  const pidFile = path.join(await workspaceDir(bot), "explorer.pid");
  const before = await agentPids(bot.configPath, pidFile);
  if (before.length === 0) {
    const started = await runBot(bot);
    return started.ok ? { ...started, note: `${bot.name} was not running, so it was started.` } : started;
  }
  await stopBot(bot);
  const started = await runBot(bot);
  if (!started.ok) return started;
  // Only a new process is a restart: the same pid means the old one never stopped and kept the old persona.
  const after = await agentPids(bot.configPath, pidFile);
  if (after.some((pid) => before.includes(pid))) {
    return { ok: false, note: `${bot.name} did not stop, so it is still running with its old persona. Try Restart again in a minute.`, how: started.how };
  }
  return { ...started, note: `${bot.name} restarted and is using the saved persona.` };
}
