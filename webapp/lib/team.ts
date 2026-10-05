// Server-side only: the owner's team, the people a Notion bot may assign tasks to. Read and written as
// common-data/team.json (the bot code's src/explorer/team.py reads the same file at each new episode),
// and the Notion workspace's people for the picker, fetched with the integration token from the
// shared keys folder. The token is read here, on the server, and never sent to the browser.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BotProfile } from "./bot";
import { BOTS_DIR, listBots, readConfig } from "./bots";

export type Member = { notionId: string; name: string; email: string; role: string; details: string; default: boolean; avatar?: string | null };
export type NotionUser = { id: string; name: string; email: string; avatar: string | null; guest?: boolean };
export type TeamDoc = { version: 1; updatedAt: string | null; members: Member[] };

const MAX_MEMBERS = 40;
const DEFAULT_FILE = process.env.TEAM_FILE || path.join(BOTS_DIR, "common-data", "team.json");
const KEY_FILE = process.env.EXPLORER_KEYS_DIR ? path.join(process.env.EXPLORER_KEYS_DIR, "notion.key") : path.join(BOTS_DIR, "common-data", "keys", "notion.key");
const NOTION_VERSION = "2022-06-28";

/** Where this bot reads the team from ([notion] team_file), normally the shared file. */
export async function teamFile(bot?: BotProfile): Promise<string> {
  if (!bot) return DEFAULT_FILE;
  const cfg = await readConfig(bot.configPath);
  const own = cfg.get("notion.team_file");
  return typeof own === "string" && own.trim() ? path.resolve(path.dirname(bot.configPath), own.replace(/^~(?=\/)/, process.env.HOME ?? "~")) : DEFAULT_FILE;
}

export async function notionEnabled(bot: BotProfile): Promise<boolean> {
  const cfg = await readConfig(bot.configPath);
  return cfg.get("notion.enabled") === true;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

function cleanMembers(raw: unknown): Member[] {
  const rows = raw && typeof raw === "object" && Array.isArray((raw as { members?: unknown }).members) ? ((raw as { members: unknown[] }).members) : Array.isArray(raw) ? raw : [];
  const out: Member[] = [];
  const seen = new Set<string>();
  for (const row of rows as Record<string, unknown>[]) {
    if (!row || typeof row !== "object") continue;
    const notionId = str(row.notionId, 80);
    const name = str(row.name, 120);
    if (!/^[0-9a-f-]{32,40}$/i.test(notionId) || !name || seen.has(notionId)) continue;
    seen.add(notionId);
    out.push({
      notionId,
      name,
      email: str(row.email, 200),
      role: str(row.role, 200),
      details: str(row.details, 1500),
      default: row.default === true,
      avatar: typeof row.avatar === "string" && /^https:\/\//.test(row.avatar) ? row.avatar.slice(0, 500) : null,
    });
    if (out.length >= MAX_MEMBERS) break;
  }
  // At most one default.
  let seenDefault = false;
  for (const m of out) {
    if (m.default && seenDefault) m.default = false;
    if (m.default) seenDefault = true;
  }
  return out;
}

export async function readTeam(file: string): Promise<TeamDoc> {
  try {
    const raw = JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8")) as { updatedAt?: unknown; members?: unknown };
    return { version: 1, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null, members: cleanMembers(raw) };
  } catch {
    return { version: 1, updatedAt: null, members: [] };
  }
}

/** Validate and save. Members must be people the workspace lists (or already saved), so a forged id never
 * reaches a Notion people property. */
export async function writeTeam(file: string, raw: unknown, known: Map<string, NotionUser>): Promise<TeamDoc> {
  const current = await readTeam(file);
  const keep = new Set(current.members.map((m) => m.notionId));
  const members = cleanMembers({ members: raw }).filter((m) => known.has(m.notionId) || keep.has(m.notionId));
  for (const m of members) {
    const u = known.get(m.notionId);
    if (u) {
      // The name is the owner's label for this person (Notion often has only an email); keep theirs.
      m.name = m.name || u.name || u.email;
      m.email = u.email || m.email;
      m.avatar = u.avatar;
    }
  }
  const doc: TeamDoc = { version: 1, updatedAt: new Date().toISOString(), members };
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`; // unique: two saves at once must not share a temp file
  await writeFile(tmp, JSON.stringify(doc, null, 1) + "\n", { mode: 0o644 });
  await rename(tmp, file);
  return doc;
}

async function token(): Promise<string | null> {
  const env = (process.env.NOTION_API_KEY ?? "").trim();
  if (env) return env;
  try {
    return (await readFile(/*turbopackIgnore: true*/ KEY_FILE, "utf8")).trim() || null;
  } catch {
    return null;
  }
}

let cache: { at: number; users: NotionUser[] } | null = null;

function person(row: Record<string, unknown>): NotionUser | null {
  if (row.type !== "person" || typeof row.id !== "string") return null;
  const p = (row.person ?? {}) as { email?: unknown };
  const email = typeof p.email === "string" ? p.email : "";
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim() : email;
  return { id: row.id, name, email, avatar: typeof row.avatar_url === "string" ? row.avatar_url : null };
}

/** The task boards the bots write to ([notion] database_id), so guests assigned there can be found. */
async function boards(): Promise<{ id: string; version: string }[]> {
  const out: { id: string; version: string }[] = [];
  for (const bot of await listBots()) {
    try {
      const cfg = await readConfig(bot.configPath);
      const id = cfg.get("notion.database_id");
      if (cfg.get("notion.enabled") === true && typeof id === "string" && id.trim()) out.push({ id: id.trim(), version: String(cfg.get("notion.api_version") ?? NOTION_VERSION) });
    } catch {
      /* not a bot with Notion */
    }
  }
  return out;
}

/** People assigned anywhere on a board. Notion's users API lists workspace members only; guests (a common
 * way to give a teammate access to one database) only show up on the pages they are assigned to. */
async function boardPeople(key: string, board: { id: string; version: string }): Promise<NotionUser[]> {
  const found = new Map<string, NotionUser>();
  const path = board.version >= "2025-09-03" ? `/v1/data_sources/${board.id}/query` : `/v1/databases/${board.id}/query`;
  let cursor: string | null = null;
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`https://api.notion.com${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "notion-version": board.version, "content-type": "application/json" },
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      signal: AbortSignal.timeout(10000),
      cache: "no-store",
    });
    if (!res.ok) break;
    const body = (await res.json()) as { results?: { properties?: Record<string, { type?: string; people?: Record<string, unknown>[] }> }[]; has_more?: boolean; next_cursor?: string | null };
    for (const page of body.results ?? []) {
      for (const prop of Object.values(page.properties ?? {})) {
        if (prop.type !== "people") continue;
        for (const row of prop.people ?? []) {
          const u = person(row);
          if (u && !found.has(u.id)) found.set(u.id, { ...u, guest: true });
        }
      }
    }
    cursor = body.has_more && body.next_cursor ? body.next_cursor : null;
    if (!cursor) break;
  }
  return [...found.values()];
}

/** People who can be assigned: workspace members from the users API, plus guests already assigned on a
 * bot's task board. Cached for five minutes. */
export async function notionUsers(force = false): Promise<{ users: NotionUser[]; error: string | null }> {
  if (cache && !force && Date.now() - cache.at < 5 * 60e3) return { users: cache.users, error: null };
  const key = await token();
  if (!key) return { users: cache?.users ?? [], error: "No Notion key: add one under Settings > Key providers, or save it as common-data/keys/notion.key." };
  const users: NotionUser[] = [];
  let cursor: string | null = null;
  try {
    for (let i = 0; i < 20; i++) {
      const url = new URL("https://api.notion.com/v1/users");
      url.searchParams.set("page_size", "100");
      if (cursor) url.searchParams.set("start_cursor", cursor);
      const res = await fetch(url, { headers: { authorization: `Bearer ${key}`, "notion-version": NOTION_VERSION }, signal: AbortSignal.timeout(10000), cache: "no-store" });
      if (res.status === 401 || res.status === 403) return { users: cache?.users ?? [], error: "Notion rejected the integration token." };
      if (!res.ok) return { users: cache?.users ?? [], error: `Notion answered HTTP ${res.status}.` };
      const body = (await res.json()) as { results?: Record<string, unknown>[]; has_more?: boolean; next_cursor?: string | null };
      for (const row of body.results ?? []) {
        const u = person(row);
        if (u) users.push(u);
      }
      cursor = body.has_more && body.next_cursor ? body.next_cursor : null;
      if (!cursor) break;
    }
    const seen = new Set(users.map((u) => u.id));
    for (const board of await boards()) {
      for (const u of await boardPeople(key, board).catch(() => [] as NotionUser[])) {
        if (!seen.has(u.id)) {
          seen.add(u.id);
          users.push(u);
        }
      }
    }
  } catch (err) {
    return { users: cache?.users ?? [], error: `Could not reach Notion: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` };
  }
  users.sort((a, b) => a.name.localeCompare(b.name));
  cache = { at: Date.now(), users };
  return { users, error: null };
}
