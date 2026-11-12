// The owner's open items in the Decisions box (creatorCC queue 401, 2026-11-10): common-data/shared-state/owner-items.json
// = {items: [{id, ts, title, how, status}]}, kept by creatorCC. An item the Validator writes for a persona section changed
// outside a CEO change also carries {bot, section, before} (queue 440): the box adds Revert, which writes before back. The box lists each open item (title, then "how" in small
// text) under the decisions; Done sets status "done" and done_ts under the same mkdir lock as the decisions file
// ("owner-items.json.lock"), and a done item never shows again. Unknown fields are kept. Node imports only, so the test
// runs with Node's own runner.
import { mkdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type OwnerItem = { id: string; ts: string; title: string; how: string; persona?: PersonaRevert };
/** A persona section the Validator found changed outside a CEO change (queue 440): Revert writes `before` back. */
export type PersonaRevert = { bot: string; section: string; before: string };

const FILE = path.join(process.env.BOTS_DIR ?? path.join(process.env.HOME ?? "", "bots"), "common-data", "shared-state", "owner-items.json");
const LOCK_STALE_MS = 30_000;
const line = (v: unknown, max = 1000) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** The lock directory `<file>.lock` around one read-modify-write, as owner-decisions.ts holds it (stale after 30 s). */
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
      else if (i > 100) throw new Error("the owner items file is locked; try again in a moment");
      else await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    await rmdir(/*turbopackIgnore: true*/ lock).catch(() => {});
  }
}

/** The open items, in the file's order; done ones and malformed ones (no id or title) are left out. */
export function parseOwnerItems(text: string): OwnerItem[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const items = doc && typeof doc === "object" ? (doc as { items?: unknown }).items : null;
  if (!Array.isArray(items)) return [];
  const out: OwnerItem[] = [];
  for (const raw of items) {
    const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    if (!r || typeof r.id !== "string" || !r.id || r.status === "done") continue;
    const title = line(r.title, 400);
    if (!title) continue;
    const persona =
      typeof r.bot === "string" && /^[a-z0-9][a-z0-9-]{0,39}$/.test(r.bot) && typeof r.section === "string" && r.section.trim() && typeof r.before === "string"
        ? { persona: { bot: r.bot, section: r.section, before: r.before } }
        : {};
    out.push({ id: r.id, ts: line(r.ts, 40), title, how: line(r.how, 600), ...persona });
  }
  return out;
}

export async function ownerItems(file = FILE): Promise<OwnerItem[]> {
  return parseOwnerItems(await readFile(/*turbopackIgnore: true*/ file, "utf8").catch(() => ""));
}

/** Mark one item done: status "done" and done_ts (local time) in the file, under the lock. */
export async function markItemDone(id: string, opts: { file?: string; now?: number } = {}): Promise<{ ok: true } | { ok: false; error: string }> {
  const file = opts.file ?? FILE;
  const now = opts.now ?? Date.now();
  return withLock(file, async () => {
    let doc: { items?: unknown[] } & Record<string, unknown>;
    try {
      doc = JSON.parse(await readFile(/*turbopackIgnore: true*/ file, "utf8")) as typeof doc;
    } catch {
      return { ok: false as const, error: "the owner items file is missing or not JSON" };
    }
    const raw = Array.isArray(doc.items) ? doc.items : [];
    const rec = raw.find((r) => r && typeof r === "object" && (r as { id?: unknown }).id === id) as Record<string, unknown> | undefined;
    if (!rec) return { ok: false as const, error: "no such item" };
    if (rec.status === "done") return { ok: false as const, error: "already done" };
    Object.assign(rec, { status: "done", done_ts: localIso(now) });
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(doc, null, 1) + "\n", { mode: 0o644 });
    await rename(tmp, file);
    return { ok: true as const };
  });
}
