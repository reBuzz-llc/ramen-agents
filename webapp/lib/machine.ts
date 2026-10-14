// Server-side only: what each bot is running on this Mac right now, read from the process table.
// `ps` lists every process once; a bot's processes are the ones started with `--config <its config>`
// plus everything below them (the Playwright driver and its Chromium). Shared services a bot talks to
// (Ollama for the model, Tor for onion reading) are matched by name, and `lsof` tells whether the bot
// holds a connection to them at this moment. Only classified names and numbers leave this module,
// never raw command lines, which can carry paths and arguments that are nobody's business.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { BotProfile } from "./bot";
import { readConfig, type TomlValue } from "./bots";
import { flags as readFlags, launchAgent, workspaceDir } from "./control";
import { isAgentProcess, isDataServerProcess, listProcesses, lockHolder, type Proc } from "./processes";

const run = promisify(execFile);

export type MachineProcessKind = "agent" | "supervisor" | "keep-awake" | "driver" | "server" | "helper";

export type MachineApp = {
  name: string;
  kind: MachineProcessKind;
  detail: string;
  pids: number[];
  processes: number;
  cpu: number; // percent of one core, summed
  memMb: number;
  uptimeSeconds: number | null;
};

export type MachineBrowser = {
  /** chromium | tor | fake */
  backend: string;
  name: string;
  detail: string;
  headless: boolean | null;
  open: boolean;
  /** The bot closes its browser while quiet mode is on; this says why a closed browser is expected. */
  closedReason: string | null;
  processes: { role: string; pid: number; cpu: number; memMb: number }[];
  cpu: number;
  memMb: number;
  uptimeSeconds: number | null;
};

export type MachineService = {
  name: string;
  role: string;
  running: boolean;
  /** true / false when the bot is running and lsof could look; null when it cannot tell. */
  connected: boolean | null;
  modelLoaded: boolean | null;
  pids: number[];
  cpu: number;
  memMb: number;
  address: string | null;
};

export type BotMachine = {
  checkedAt: string;
  platform: string;
  running: boolean;
  status: string;
  /** PAUSE / STOP files in the workspace. */
  flags: string[];
  /** launchd label when `bot install` set one up; null for a bot run by hand. */
  launchAgent: string | null;
  browser: MachineBrowser;
  apps: MachineApp[];
  services: MachineService[];
  remote: { name: string; model: string; connections: number } | null;
  quiet: { enabled: boolean; frontmostApp: string | null; watched: { name: string; running: boolean }[] };
  desktop: { enabled: boolean; dryRun: boolean; allowedApps: string[] };
  totals: { processes: number; cpu: number; memMb: number };
  error: string | null;
};

// ---------------------------------------------------------------------------------------------
// Snapshots, shared for a moment so several open dashboards do not each run ps.

let snapshot: { at: number; procs: Proc[]; front: string | null } | null = null;
let pending: Promise<{ procs: Proc[]; front: string | null }> | null = null;
const SNAPSHOT_MS = 1500;

/** The app in front, the same probe quiet mode uses (src/explorer/presence.py). */
async function frontmostApp(): Promise<string | null> {
  try {
    const asn = (await run("/usr/bin/lsappinfo", ["front"], { timeout: 2000 })).stdout.trim();
    if (!asn) return null;
    const info = (await run("/usr/bin/lsappinfo", ["info", "-only", "name", asn], { timeout: 2000 })).stdout;
    return info.match(/"LSDisplayName"="([^"]*)"/)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function takeSnapshot(): Promise<{ procs: Proc[]; front: string | null }> {
  if (snapshot && Date.now() - snapshot.at < SNAPSHOT_MS) return snapshot;
  pending ??= Promise.all([listProcesses(), frontmostApp()])
    .then(([procs, front]) => {
      snapshot = { at: Date.now(), procs, front };
      return snapshot;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

/** Local TCP ports a set of processes is connected to right now. null when lsof cannot tell. */
async function connectedPorts(pids: number[]): Promise<{ local: Set<number>; external: number } | null> {
  if (pids.length === 0) return null;
  try {
    const { stdout } = await run("/usr/sbin/lsof", ["-a", "-p", pids.join(","), "-iTCP", "-sTCP:ESTABLISHED", "-nP", "-Fn"], {
      timeout: 3000,
    });
    const local = new Set<number>();
    let external = 0;
    for (const line of stdout.split("\n")) {
      if (!line.startsWith("n") || !line.includes("->")) continue;
      const remote = line.slice(line.indexOf("->") + 2);
      const port = Number(remote.slice(remote.lastIndexOf(":") + 1));
      if (/^(127\.0\.0\.1|\[::1\]|localhost):/.test(remote)) local.add(port);
      else external++;
    }
    return { local, external };
  } catch (err) {
    // lsof exits 1 when nothing matches, which just means no open connections.
    const code = (err as { code?: number }).code;
    return code === 1 ? { local: new Set(), external: 0 } : null;
  }
}

// ---------------------------------------------------------------------------------------------
// Classifying processes

const mb = (kb: number) => Math.round((kb / 1024) * 10) / 10;
const round1 = (n: number) => Math.round(n * 10) / 10;

function chromiumRole(args: string): string {
  const type = args.match(/--type=([\w-]+)/)?.[1];
  if (!type) return "main browser";
  if (type === "renderer") return "page renderer";
  if (type === "gpu-process") return "GPU";
  if (type === "utility") {
    const sub = args.match(/--utility-sub-type=([\w.]+)/)?.[1] ?? "";
    if (sub.startsWith("network")) return "network service";
    if (sub.startsWith("storage")) return "storage service";
    return "utility";
  }
  return type;
}

function isChromium(args: string): boolean {
  return /chrome-headless-shell|Chromium\.app|Google Chrome for Testing|ms-playwright\/chromium/.test(args);
}

function chromiumName(args: string): { name: string; detail: string; headless: boolean } {
  const build = args.match(/chromium(?:_headless_shell)?-(\d+)/)?.[1];
  const suffix = build ? `Playwright build ${build}` : "installed by Playwright";
  if (args.includes("chrome-headless-shell")) {
    return { name: "Chromium headless shell", detail: `Hidden window, ${suffix}`, headless: true };
  }
  if (args.includes("Google Chrome for Testing")) {
    return { name: "Chrome for Testing", detail: `Visible window, ${suffix}`, headless: /--headless/.test(args) };
  }
  return { name: "Chromium", detail: `Visible window, ${suffix}`, headless: /--headless/.test(args) };
}

function descendants(root: number, children: Map<number, Proc[]>): Proc[] {
  const out: Proc[] = [];
  const stack = [...(children.get(root) ?? [])];
  while (stack.length) {
    const p = stack.pop()!;
    out.push(p);
    stack.push(...(children.get(p.pid) ?? []));
  }
  return out;
}

function portOf(url: string, fallback: number): number {
  try {
    const u = new URL(url);
    return u.port ? Number(u.port) : fallback;
  } catch {
    return fallback;
  }
}

function remoteName(provider: string, baseUrl: string): string {
  if (provider === "gemini") return "Google Gemini API";
  try {
    const host = new URL(baseUrl).hostname.replace(/^api\./, "");
    const known: [string, string][] = [
      ["groq", "Groq"],
      ["cerebras", "Cerebras"],
      ["together", "Together AI"],
      ["mistral", "Mistral"],
      ["deepinfra", "DeepInfra"],
      ["fireworks", "Fireworks AI"],
    ];
    const hit = known.find(([needle]) => host.includes(needle));
    return `${hit ? hit[1] : host} API`;
  } catch {
    return `${provider} API`;
  }
}

// ---------------------------------------------------------------------------------------------

export async function inspectBot(bot: BotProfile, heartbeatStatus: string | null): Promise<BotMachine> {
  const checkedAt = new Date().toISOString();
  let toml = new Map<string, TomlValue>();
  try {
    toml = await readConfig(bot.configPath);
  } catch {
    /* defaults below */
  }
  const str = (key: string, fallback: string) => {
    const v = toml.get(key);
    return typeof v === "string" ? v : fallback;
  };
  const bool = (key: string, fallback: boolean) => {
    const v = toml.get(key);
    return typeof v === "boolean" ? v : fallback;
  };
  const list = (key: string, fallback: string[]) => {
    const v = toml.get(key);
    return Array.isArray(v) ? v : fallback;
  };

  // Defaults mirror src/explorer/config.py.
  const mode = str("agent.mode", "fake");
  const backend = mode === "fake" ? "fake" : str("browser.backend", "light"); // the bot code's default (config.py)
  const headlessCfg = bool("browser.headless", true);
  const provider = str("model.provider", "fake");
  const fallback = str("model.fallback_provider", "ollama");
  const chain = list("model.provider_chain", []);
  const ollamaHost = str("model.host", "http://localhost:11434");
  const torProxy = str("browser.tor_proxy", "socks5h://127.0.0.1:9050");
  const quietEnabled = bool("quiet.enabled", true);
  const closeBrowser = bool("quiet.close_browser", true);
  const quietApps = list("quiet.apps", ["Steam", "Epic Games Launcher"]);
  const quietProcs = list("quiet.processes", ["steam_osx", "Epic Games Launcher"]);

  const empty: BotMachine = {
    checkedAt,
    platform: process.platform,
    running: false,
    status: "unknown",
    flags: [],
    launchAgent: null,
    browser: { backend, name: "", detail: "", headless: null, open: false, closedReason: null, processes: [], cpu: 0, memMb: 0, uptimeSeconds: null },
    apps: [],
    services: [],
    remote: null,
    quiet: { enabled: quietEnabled, frontmostApp: null, watched: [] },
    desktop: {
      enabled: bool("desktop.enabled", false),
      dryRun: bool("desktop.dry_run", true),
      allowedApps: list("desktop.allowed_apps", ["TextEdit", "Calculator", "Notes"]),
    },
    totals: { processes: 0, cpu: 0, memMb: 0 },
    error: null,
  };

  if (process.platform !== "darwin") {
    return { ...empty, error: "Process details are only read on macOS." };
  }

  let snap: { procs: Proc[]; front: string | null };
  try {
    snap = await takeSnapshot();
  } catch (err) {
    return { ...empty, error: `Could not read the process list: ${err instanceof Error ? err.message : String(err)}` };
  }
  const { procs, front } = snap;
  const byPid = new Map(procs.map((p) => [p.pid, p]));
  const children = new Map<number, Proc[]>();
  for (const p of procs) {
    const list = children.get(p.ppid);
    if (list) list.push(p);
    else children.set(p.ppid, [p]);
  }

  // The bot's own processes.
  const agent =
    procs.find((p) => isAgentProcess(p.args, bot.configPath)) ??
    (await lockHolder(path.join(await workspaceDir(bot), "explorer.pid"), procs).catch(() => null));
  const dataServer = procs.find((p) => isDataServerProcess(p.args, bot.configPath)) ?? null;

  const apps: MachineApp[] = [];
  const counted = new Set<number>();
  const addApp = (name: string, kind: MachineProcessKind, detail: string, group: Proc[], uptimeFrom?: Proc) => {
    const fresh = group.filter((p) => !counted.has(p.pid));
    if (fresh.length === 0) return;
    fresh.forEach((p) => counted.add(p.pid));
    apps.push({
      name,
      kind,
      detail,
      pids: fresh.map((p) => p.pid),
      processes: fresh.length,
      cpu: round1(fresh.reduce((a, p) => a + p.cpu, 0)),
      memMb: mb(fresh.reduce((a, p) => a + p.rssKb, 0)),
      uptimeSeconds: (uptimeFrom ?? fresh[0]).elapsed,
    });
  };

  const browser: MachineBrowser = { ...empty.browser };
  if (agent) {
    // Supervisor chain above the agent (supervise.sh under launchd), and the caffeinate beside it.
    const supervisors: Proc[] = [];
    let up = byPid.get(agent.ppid);
    while (up && up.pid > 1 && /supervise\.sh/.test(up.args)) {
      supervisors.push(up);
      up = byPid.get(up.ppid);
    }
    const keepAwake = supervisors.flatMap((s) => (children.get(s.pid) ?? []).filter((c) => /(^|\/)caffeinate\s/.test(c.args)));
    // A bot packaged as a Mac app (Desk Agent.app); Python's own framework bundle (Python.app) doesn't count.
    const appBundle = [...agent.args.matchAll(/\/([^/]+)\.app\/Contents\/MacOS\//g)].map((m) => m[1]).find((n) => n !== "Python");
    addApp("Bot agent", "agent", appBundle ? `${appBundle}.app · ${mode} mode` : `Python · bot run · ${mode} mode`, [agent]);
    if (supervisors.length) addApp("Supervisor", "supervisor", "supervise.sh · restarts and rolls back the agent", supervisors);
    if (keepAwake.length) addApp("caffeinate", "keep-awake", "Keeps the Mac from sleeping while the bot runs", keepAwake);

    const below = descendants(agent.pid, children);
    const chrome = below.filter((p) => isChromium(p.args));
    const drivers = below.filter((p) => /playwright\/driver/.test(p.args));
    if (drivers.length) addApp("Playwright driver", "driver", "Node.js · controls the browser for the agent", drivers);
    if (chrome.length) {
      chrome.forEach((p) => counted.add(p.pid));
      const main = chrome.find((p) => !/--type=/.test(p.args)) ?? chrome[0];
      const named = chromiumName(main.args);
      Object.assign(browser, {
        name: named.name,
        detail: named.detail,
        headless: named.headless,
        open: true,
        processes: chrome
          .map((p) => ({ role: chromiumRole(p.args), pid: p.pid, cpu: round1(p.cpu), memMb: mb(p.rssKb) }))
          .sort((a, b) => b.memMb - a.memMb),
        cpu: round1(chrome.reduce((a, p) => a + p.cpu, 0)),
        memMb: mb(chrome.reduce((a, p) => a + p.rssKb, 0)),
        uptimeSeconds: main.elapsed,
      });
    }
    const rest = below.filter((p) => !counted.has(p.pid));
    for (const p of rest) {
      const exe = p.args.split(" ")[0].split("/").pop() ?? "process";
      addApp(exe, "helper", "Started by the agent", [p]);
    }
  }
  if (dataServer) addApp("Data server", "server", `Python · bot dashboard · port ${bot.port}`, [dataServer]);

  // What the browser is, when no browser process is up.
  if (!browser.open) {
    if (backend === "tor") {
      Object.assign(browser, {
        name: "Tor text reader",
        detail: "No browser engine: plain HTTP requests through Tor, text only, inside the agent",
        headless: null,
        open: agent !== null,
      });
    } else if (backend === "light") {
      Object.assign(browser, {
        name: "Light browser",
        detail: "Plain HTTP requests inside the agent; Chromium opens only for pages that need it",
        headless: null,
        open: agent !== null,
      });
    } else if (backend === "fake") {
      Object.assign(browser, { name: "Fake browser", detail: "Local HTML pages, no network, inside the agent", headless: null, open: agent !== null });
    } else {
      Object.assign(browser, {
        name: headlessCfg ? "Chromium headless shell" : "Chromium",
        detail: headlessCfg ? "Hidden window, installed by Playwright" : "Visible window, installed by Playwright",
        headless: headlessCfg,
        closedReason: !agent
          ? "The bot is not running."
          : heartbeatStatus === "quiet" && closeBrowser
            ? "Quiet mode closed it while you use the Mac. It reopens when the bot resumes."
            : "Not open right now. The agent starts it when it next reads a page.",
      });
    }
  }

  // Shared services.
  const ownPids = [agent, ...(agent ? descendants(agent.pid, children) : [])].filter((p): p is Proc => p !== null).map((p) => p.pid);
  const conns = agent ? await connectedPorts(ownPids) : null;
  const services: MachineService[] = [];

  const usesOllama = provider === "ollama" || fallback === "ollama";
  if (usesOllama) {
    const serve = procs.filter((p) => /(^|\/)ollama\s+serve(\s|$)/.test(p.args) || /(^|\/)Ollama\.app\/Contents\/MacOS\/Ollama/.test(p.args));
    const runners = procs.filter((p) => /(^|\/)(llama-server|ollama_llama_server)\s/.test(p.args) || /(^|\/)ollama\s+runner(\s|$)/.test(p.args));
    const all = [...serve, ...runners];
    const port = portOf(ollamaHost, 11434);
    services.push({
      name: "Ollama",
      role: provider === "ollama" ? `Model · ${str("model.name", "qwen2.5:7b")}` : `Fallback model · ${str("model.name", "qwen2.5:7b")}`,
      running: serve.length > 0,
      connected: conns ? conns.local.has(port) : null,
      modelLoaded: serve.length > 0 ? runners.length > 0 : null,
      pids: all.map((p) => p.pid),
      cpu: round1(all.reduce((a, p) => a + p.cpu, 0)),
      memMb: mb(all.reduce((a, p) => a + p.rssKb, 0)),
      address: `127.0.0.1:${port}`,
    });
  }
  if (backend === "tor") {
    const tor = procs.filter((p) => /(^|\/)tor(\s|$)/.test(p.args) || /Tor Browser\.app\/.*\/tor(\s|$)/.test(p.args));
    const port = portOf(torProxy.replace(/^socks5h?:/, "http:"), 9050);
    services.push({
      name: "Tor",
      role: "SOCKS proxy for onion sites",
      running: tor.length > 0,
      connected: conns ? conns.local.has(port) : null,
      modelLoaded: null,
      pids: tor.map((p) => p.pid),
      cpu: round1(tor.reduce((a, p) => a + p.cpu, 0)),
      memMb: mb(tor.reduce((a, p) => a + p.rssKb, 0)),
      address: `127.0.0.1:${port}`,
    });
  }

  // SearXNG (launch agent com.ramen-agents.searxng): the local metasearch the bot's `searxng` engine queries.
  if (list("browser.search_engines", []).includes("searxng")) {
    const searx = procs.filter((p) => /-m searx\.webapp(\s|$)/.test(p.args) || /(^|\/)searxng-run(\s|$)/.test(p.args));
    const base = str("browser.searxng_url", "http://127.0.0.1:8888");
    const port = portOf(base, 8888);
    let answering = false;
    if (searx.length) {
      try {
        answering = (await fetch(new URL("/healthz", base), { cache: "no-store", signal: AbortSignal.timeout(1500) })).ok;
      } catch {
        answering = false;
      }
    }
    services.push({
      name: "SearXNG",
      role: answering || !searx.length ? "Local web search (Google, DuckDuckGo, Brave, ...)" : "Local web search · process up but not answering",
      running: searx.length > 0 && answering,
      connected: conns ? conns.local.has(port) : null,
      modelLoaded: null,
      pids: searx.map((p) => p.pid),
      cpu: round1(searx.reduce((a, p) => a + p.cpu, 0)),
      memMb: mb(searx.reduce((a, p) => a + p.rssKb, 0)),
      address: `127.0.0.1:${port}`,
    });
  }

  const remoteProvider = chain[0] ?? (provider === "ollama" || provider === "fake" ? null : provider);
  // A chain entry other than "gemini" names a [model.providers.<name>] table (OpenRouter was removed).
  const remote = remoteProvider
    ? {
        name: remoteName(remoteProvider, str(`model.providers.${remoteProvider}.base_url`, "")),
        model:
          remoteProvider === "gemini"
            ? str("model.gemini_model", "gemini-2.5-flash")
            : str(`model.providers.${remoteProvider}.model`, ""),
        connections: conns?.external ?? 0,
      }
    : null;

  // Same rules as quiet mode: an app counts when it is in front, a process name when it appears in ps.
  const watched = [...new Set([...quietApps, ...quietProcs])].map((name) => {
    const lower = name.toLowerCase();
    const running =
      front === name ||
      (quietProcs.includes(name) && procs.some((p) => p.args.toLowerCase().includes(lower))) ||
      procs.some((p) => p.args.toLowerCase().includes(`/${lower}.app/`));
    return { name, running };
  });

  const status = !agent ? "not running" : heartbeatStatus ?? "running";
  const totalsFrom = [...apps.flatMap((a) => a.pids), ...browser.processes.map((p) => p.pid)];
  const totalProcs = totalsFrom.map((pid) => byPid.get(pid)).filter((p): p is Proc => !!p);

  const [flagList, agentJob] = await Promise.all([readFlags(bot).catch(() => []), launchAgent(bot).catch(() => null)]);

  return {
    ...empty,
    running: agent !== null,
    status,
    flags: flagList,
    launchAgent: agentJob?.label ?? null,
    browser,
    apps,
    services,
    remote,
    quiet: { enabled: quietEnabled, frontmostApp: front, watched },
    totals: {
      processes: totalProcs.length,
      cpu: round1(totalProcs.reduce((a, p) => a + p.cpu, 0)),
      memMb: mb(totalProcs.reduce((a, p) => a + p.rssKb, 0)),
    },
  };
}
