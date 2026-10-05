// Server-side only: finds the bots on this Mac. Each bot is a folder under BOTS_DIR (default ~/bots)
// holding a config.toml, the layout `bot new` creates (src/explorer/fleet.py).
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import type { BotProfile, BotState, BotSummary } from "./bot";
import { handleFor } from "./handle";

export const BOTS_DIR = process.env.BOTS_DIR ?? path.join(homedir(), "bots");
export const CODE_ROOT = process.env.BOT_CODE_ROOT ?? path.join(homedir(), "Projects", "bot");

// Defaults from src/explorer/config.py (DashboardConfig).
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8787;
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

export type TomlValue = string | number | boolean | string[];

/** Reads the top-level string, integer, boolean and string-array keys of each [section]. Not a full
 * TOML parser: enough for names, ports, backends and the quiet-mode app lists. */
export function readToml(text: string): Map<string, TomlValue> {
  const out = new Map<string, TomlValue>();
  let section = "";
  let pending: { key: string; buf: string } | null = null;
  const unquote = (v: string) => v.replace(/\\(["\\])/g, "$1");
  const strings = (body: string) => [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => unquote(m[1]));
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (pending) {
      pending.buf += " " + line.replace(/#[^"]*$/, "");
      if (line.startsWith("]") || /\]\s*(?:#.*)?$/.test(line)) {
        out.set(pending.key, strings(pending.buf));
        pending = null;
      }
      continue;
    }
    const header = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (header) {
      section = header[1];
      continue;
    }
    const str = line.match(/^([A-Za-z0-9_]+)\s*=\s*"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/);
    if (str) {
      out.set(`${section}.${str[1]}`, unquote(str[2]));
      continue;
    }
    const num = line.match(/^([A-Za-z0-9_]+)\s*=\s*(\d+(?:\.\d+)?)\s*(?:#.*)?$/);
    if (num) {
      out.set(`${section}.${num[1]}`, Number(num[2]));
      continue;
    }
    const bool = line.match(/^([A-Za-z0-9_]+)\s*=\s*(true|false)\s*(?:#.*)?$/);
    if (bool) {
      out.set(`${section}.${bool[1]}`, bool[2] === "true");
      continue;
    }
    const arr = line.match(/^([A-Za-z0-9_]+)\s*=\s*\[(.*)$/);
    if (arr) {
      const key = `${section}.${arr[1]}`;
      if (/\]\s*(?:#.*)?$/.test(arr[2])) out.set(key, strings(arr[2]));
      else pending = { key, buf: arr[2] };
    }
  }
  return out;
}

/** A bot's config with the shared files named in its top-level `extends` merged underneath, the way
 * src/explorer/config.py loads it: paths are relative to the file that names them, and the bot's own
 * values win. Keys are flat ("model.providers.groq.model"), so tables merge key by key. */
export async function readConfig(configPath: string, seen: string[] = []): Promise<Map<string, TomlValue>> {
  const real = path.resolve(configPath);
  if (seen.includes(real)) throw new Error(`extends loop: ${[...seen, real].join(" -> ")}`);
  const own = readToml(await readFile(/*turbopackIgnore: true*/ real, "utf8"));
  const raw = own.get(".extends");
  own.delete(".extends");
  const bases = typeof raw === "string" ? [raw] : Array.isArray(raw) ? raw : [];
  const merged = new Map<string, TomlValue>();
  for (const base of bases) {
    const file = path.resolve(path.dirname(real), base.replace(/^~(?=\/)/, homedir()));
    for (const [k, v] of await readConfig(file, [...seen, real])) merged.set(k, v);
  }
  for (const [k, v] of own) merged.set(k, v);
  return merged;
}

export async function listBots(): Promise<BotProfile[]> {
  let entries: string[];
  try {
    entries = await readdir(/*turbopackIgnore: true*/ BOTS_DIR);
  } catch {
    return [];
  }
  const bots = await Promise.all(
    entries.filter((e) => SLUG.test(e)).map(async (slug): Promise<(BotProfile & { portSet: boolean }) | null> => {
      const configPath = path.join(BOTS_DIR, slug, "config.toml");
      try {
        const toml = await readConfig(configPath);
        const port = toml.get("dashboard.port");
        // A timer job (the Validator, valB) is not shown here at all (owner, 2026-09-25): it has no loop to run or
        // watch, only a report. Its config marks it with [agent] not_a_bot_run_agent = true.
        if (toml.get("agent.not_a_bot_run_agent") === true) return null;
        return {
          slug,
          name: String(toml.get("agent.name") ?? slug),
          bio: String(toml.get("agent.bio") ?? ""),
          port: typeof port === "number" && port > 0 && port < 65536 ? port : DEFAULT_PORT,
          portSet: typeof port === "number" && port > 0 && port < 65536,
          configPath,
          handle: handleFor(String(toml.get("agent.name") ?? slug)),
        };
      } catch {
        return null; // not a bot folder
      }
    }),
  );
  const found = bots.filter((b): b is BotProfile & { portSet: boolean } => b !== null);
  // A bot with no [dashboard] port falls back to DEFAULT_PORT. Two such bots would share it, and one bot's chat token
  // would be posted to the other's data server and its page would show the other's data: a port taken by more than
  // one bot, and not set explicitly, is given to none of them (port 0 never connects, so the page says offline).
  const users = new Map<number, number>();
  for (const b of found) users.set(b.port, (users.get(b.port) ?? 0) + 1);
  return found
    .map(({ portSet, ...b }) => (!portSet && (users.get(b.port) ?? 0) > 1 ? { ...b, port: 0 } : b))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function findBot(slug: string): Promise<BotProfile | null> {
  if (!SLUG.test(slug)) return null;
  return (await listBots()).find((b) => b.slug === slug) ?? null;
}

export function dataServerUrl(bot: BotProfile, pathname: string): URL {
  return new URL(pathname, `http://${DEFAULT_HOST}:${bot.port}`);
}

/** The bot's live state from its data server, or null when it is offline or another bot answers on its port. */
export async function fetchState(bot: BotProfile, timeoutMs = 2000): Promise<BotState | null> {
  try {
    const res = await fetch(dataServerUrl(bot, "/api/state"), { cache: "no-store", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const s = (await res.json()) as BotState;
    // Two bots with the same port would show one bot's data under the other's name; trust the name it reports.
    return s.agent?.name === bot.name ? s : null;
  } catch {
    return null;
  }
}

export async function summarize(bot: BotProfile): Promise<BotSummary> {
  const s = await fetchState(bot);
  if (!s) return { ...bot, online: false, running: false, status: null, flags: [], stale: false, heartbeatAge: null };
  return {
    ...bot,
    online: true,
    running: s.running,
    status: s.heartbeat?.status ?? null,
    flags: s.flags,
    stale: s.stale,
    heartbeatAge: s.heartbeat_age,
  };
}
