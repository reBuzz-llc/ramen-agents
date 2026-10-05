// Server-side only: this Mac's process table, and which processes belong to a bot. One reader for the
// "On this Mac" panel (lib/machine.ts) and for Run / Stop (lib/control.ts), so both agree on what
// "the bot is running" means.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);

export type Proc = { pid: number; ppid: number; cpu: number; rssKb: number; elapsed: number; args: string };

/** ps's etime, [[dd-]hh:]mm:ss, in seconds. */
function parseElapsed(text: string): number {
  const [days, rest] = text.includes("-") ? text.split("-") : ["0", text];
  const parts = rest.split(":").map(Number);
  while (parts.length < 3) parts.unshift(0);
  const [h, m, s] = parts;
  return Number(days) * 86400 + h * 3600 + m * 60 + s;
}

export async function listProcesses(): Promise<Proc[]> {
  const { stdout } = await run("/bin/ps", ["-axww", "-o", "pid=,ppid=,pcpu=,rss=,etime=,args="], {
    timeout: 4000,
    maxBuffer: 16 * 1024 * 1024,
  });
  const procs: Proc[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (m) procs.push({ pid: +m[1], ppid: +m[2], cpu: +m[3], rssKb: +m[4], elapsed: parseElapsed(m[5]), args: m[6] });
  }
  return procs;
}

/** The part of a command line after `--config <configPath>`, or null when it names another config. */
function afterConfig(args: string, configPath: string): string | null {
  const needle = `--config ${configPath}`;
  const i = args.indexOf(needle);
  if (i < 0) return null;
  const after = args.slice(i + needle.length);
  return after === "" || after.startsWith(" ") ? after : null;
}

/** `bot --config <configPath> run` (or `explore`): the agent itself. */
export function isAgentProcess(args: string, configPath: string): boolean {
  const after = afterConfig(args, configPath);
  return after !== null && /\bbot\b/.test(args) && /\s(run|explore)(\s|$)/.test(after);
}

/** `bot --config <configPath> dashboard`: the bot's data server. */
export function isDataServerProcess(args: string, configPath: string): boolean {
  const after = afterConfig(args, configPath);
  return after !== null && /\sdashboard(\s|$)/.test(after);
}

/** The process holding the bot's run lock (workspace/explorer.pid), when it is alive. Catches agents that
 * are not a `bot ... run` command line, such as the Desk Agent.app bundle (rebuzzBot.app before 2026-09-25) running the Desk Agent. */
export async function lockHolder(pidFile: string, procs: Proc[]): Promise<Proc | null> {
  let pid: number;
  try {
    pid = Number((await readFile(/*turbopackIgnore: true*/ pidFile, "utf8")).trim());
  } catch {
    return null;
  }
  if (!Number.isInteger(pid) || pid <= 1) return null;
  const proc = procs.find((p) => p.pid === pid);
  // A stale pid file can name a reused pid: only trust a process that looks like a bot...
  if (!(proc && /\bbot\b|explorer|rebuzzBot|python|\.app\/Contents\/MacOS\//i.test(proc.args) && !/\sdashboard(\s|$)/.test(proc.args))) return null;
  // ...and that still holds the pid file open. The bot keeps it open (and flocked) for as long as it runs, and a
  // stop only unlocks it, so the number in it outlives the bot; macOS can hand that pid to SearXNG's Python.
  const holders = await openedBy(pidFile);
  return holders === null || holders.includes(pid) ? proc : null;
}

/** The pids that have this file open (lsof -t), or null when lsof cannot say (then the caller trusts the pid). */
async function openedBy(file: string): Promise<number[] | null> {
  try {
    const { stdout } = await run("/usr/sbin/lsof", ["-t", "--", file], { timeout: 3000 });
    return stdout.split(/\s+/).filter(Boolean).map(Number);
  } catch (err) {
    // lsof exits 1 with no output when nobody has the file open: that is an answer, not a failure.
    const e = err as { code?: number; stdout?: string };
    return e.code === 1 && !(e.stdout ?? "").trim() ? [] : null;
  }
}

export async function agentPids(configPath: string, pidFile?: string): Promise<number[]> {
  const procs = await listProcesses();
  const pids = new Set(procs.filter((p) => isAgentProcess(p.args, configPath)).map((p) => p.pid));
  if (pidFile) {
    const holder = await lockHolder(pidFile, procs);
    if (holder) pids.add(holder.pid);
  }
  return [...pids];
}
