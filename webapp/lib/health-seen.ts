// "Seen" on the health banner (creatorCC queue 54; owner, 10-31: "cannot interact with this, cannot clear it as a
// user"): each line gets a Seen button; Seen writes {id, text, seen_at} to shared-state/health-seen.json, and the line
// stays hidden until its fact changes. The id is a hash of the fact (the issue's key and since: a new reboot time, a new
// outage start, another idle bot or a later Validator failure is a new fact), never its words. Two tabs may write at
// once, so every read-modify-write holds the lock directory "health-seen.json.lock", as owner-decisions does (a lock
// older than 30 s is broken). Node imports only, so the test runs with Node's own runner.
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type Seen = Record<string, { text: string; seen_at: string }>;
const LOCK_STALE_MS = 30_000;
export const SEEN_FILE = path.join(process.env.BOTS_DIR ?? path.join(process.env.HOME ?? "", "bots"), "common-data", "shared-state", "health-seen.json");

/** The fact behind a banner line: its key and since, hashed. */
export const factId = (i: { key: string; since: string }) => createHash("sha1").update(`${i.key}\0${i.since}`, "utf8").digest("hex").slice(0, 16);
export const isFactId = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{16}$/.test(v);

export function parseSeen(text: string): Seen {
  try {
    const o = JSON.parse(text) as unknown;
    return o && typeof o === "object" && !Array.isArray(o) ? (o as Seen) : {};
  } catch {
    return {};
  }
}

/** The lines still to show, each with its id. */
export function unseen<I extends { key: string; since: string }>(issues: I[], seen: Seen): (I & { id: string })[] {
  return issues.map((i) => ({ ...i, id: factId(i) })).filter((i) => !seen[i.id]);
}

export async function readSeen(file = SEEN_FILE): Promise<Seen> {
  return parseSeen(await readFile(/*turbopackIgnore: true*/ file, "utf8").catch(() => "{}"));
}

async function withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
  for (let i = 0; ; i++) {
    try {
      await mkdir(/*turbopackIgnore: true*/ lock);
      break;
    } catch {
      const age = await stat(/*turbopackIgnore: true*/ lock).then((s) => Date.now() - s.mtimeMs, () => 0);
      if (age > LOCK_STALE_MS) await rmdir(/*turbopackIgnore: true*/ lock).catch(() => {});
      else if (i > 100) throw new Error("the seen file is locked; try again in a moment");
      else await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    await rmdir(/*turbopackIgnore: true*/ lock).catch(() => {});
  }
}

const localIso = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};

/** Mark one line seen (under the lock; facts seen over 30 days ago are dropped, so the file stays small). */
export async function markSeen(o: { id: string; text: string; now?: number; file?: string }): Promise<Seen> {
  const file = o.file ?? SEEN_FILE;
  const now = o.now ?? Date.now();
  return withLock(file, async () => {
    const seen = await readSeen(file);
    const cut = localIso(now - 30 * 86400e3);
    for (const [id, v] of Object.entries(seen)) if (!v || typeof v.seen_at !== "string" || v.seen_at < cut) delete seen[id];
    seen[o.id] = { text: o.text.replace(/\s+/g, " ").trim().slice(0, 300), seen_at: localIso(now) };
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(seen, null, 1) + "\n");
    await rename(tmp, file);
    return seen;
  });
}
