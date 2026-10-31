// Decisions waiting for the owner (2026-10-31; was a read-only owner-decisions.md since queue 9):
//   common-data/shared-state/owner-decisions.json = {version, items: [{id, since, text, options: [...], link?: {label,
//   href}, status: open | done | later | decided, choice?, note?, decided_at?, wake?}]}.
// The planner (a person or a planning agent) adds items; the owner answers on the dashboard, one click per item: one of its options (status "decided",
// choice), Done, or Later (status "later", wake = three days on; the item shows again from then). Each answer sets
// status, choice, note and decided_at in the file and appends the record to shared-state/owner-decisions-log.jsonl,
// which the planner reads to act on each answer. Two writers share the file, so every read-modify-write holds the lock
// directory "owner-decisions.json.lock", as the CEO proposals do (a lock older than 30 s is broken). Unknown fields
// are kept. Node imports only, so the test runs with Node's own runner.
import { appendFile, mkdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type Decision = {
  id: string;
  since: string;
  text: string;
  options: string[];
  link: { label: string; href: string } | null;
  status: "open" | "done" | "later" | "decided";
  choice: string;
  note: string;
  decided_at: string;
  wake: string;
};
export type Answer = { kind: "choose"; choice: string } | { kind: "done" } | { kind: "later" };
type Files = { items: string; log: string };

const LOCK_STALE_MS = 30_000;
const LATER_DAYS = 3;
const SHOW_DECIDED_DAYS = 30;
const SHARED = path.join(process.env.BOTS_DIR ?? path.join(process.env.HOME ?? "", "bots"), "common-data", "shared-state");
const FILES: Files = { items: path.join(SHARED, "owner-decisions.json"), log: path.join(SHARED, "owner-decisions-log.jsonl") };

const line = (v: unknown, max = 1000) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function parseOne(raw: unknown): Decision | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.id !== "string" || !r.id || !line(r.text)) return null;
  const l = r.link && typeof r.link === "object" ? (r.link as Record<string, unknown>) : null;
  const status = r.status === "done" || r.status === "later" || r.status === "decided" ? r.status : "open";
  return {
    id: r.id,
    since: line(r.since, 40),
    text: line(r.text),
    options: Array.isArray(r.options) ? r.options.map((o) => line(o, 120)).filter(Boolean) : [],
    link: l && line(l.href, 300) ? { label: line(l.label, 80) || "Open", href: line(l.href, 300) } : null,
    status,
    choice: line(r.choice, 120),
    note: line(r.note, 300),
    decided_at: line(r.decided_at, 40),
    wake: line(r.wake, 40),
  };
}

/** Every item the file holds, in its order; a malformed item is left out (and kept in the file). */
export function parseItems(text: string): Decision[] {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return [];
  }
  const items = doc && typeof doc === "object" ? (doc as { items?: unknown }).items : null;
  return Array.isArray(items) ? items.map(parseOne).filter((d): d is Decision => d !== null) : [];
}

/** What the box shows: the open items (a "later" one again once its wake time has come), and the items decided or
 *  done in the last 30 days, newest first. */
export function partition(items: Decision[], now: number): { open: Decision[]; decided: Decision[] } {
  const stamp = localIso(now);
  const since = localIso(now - SHOW_DECIDED_DAYS * 86400e3);
  const open = items.filter((d) => d.status === "open" || (d.status === "later" && (!d.wake || d.wake <= stamp)));
  const decided = items
    .filter((d) => (d.status === "decided" || d.status === "done") && d.decided_at >= since)
    .sort((a, b) => b.decided_at.localeCompare(a.decided_at));
  return { open, decided };
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
      else if (i > 100) throw new Error("the decisions file is locked; try again in a moment");
      else await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    await rmdir(/*turbopackIgnore: true*/ lock).catch(() => {});
  }
}

/** Answer one item: choose one of its options, Done, or Later (three days). Sets status, choice, note, decided_at (and
 *  wake for Later) in the file under the lock, then appends the record to the log. */
export async function decide(id: string, answer: Answer, note: string, opts: { files?: Files; now?: number } = {}): Promise<{ ok: true; item: Decision } | { ok: false; error: string }> {
  const files = opts.files ?? FILES;
  const now = opts.now ?? Date.now();
  return withLock(files.items, async () => {
    const text = await readFile(/*turbopackIgnore: true*/ files.items, "utf8").catch(() => "");
    let doc: { items?: unknown[] } & Record<string, unknown>;
    try {
      doc = JSON.parse(text) as typeof doc;
    } catch {
      return { ok: false as const, error: "the decisions file is missing or not JSON" };
    }
    const raw = Array.isArray(doc.items) ? doc.items : [];
    const at = raw.findIndex((r) => r && typeof r === "object" && (r as { id?: unknown }).id === id);
    const item = at < 0 ? null : parseOne(raw[at]);
    if (!item) return { ok: false as const, error: "no such decision" };
    if (item.status === "decided" || item.status === "done") return { ok: false as const, error: "already answered" };
    const rec = raw[at] as Record<string, unknown>;
    const stamp = localIso(now);
    if (answer.kind === "choose") {
      if (!item.options.includes(answer.choice)) return { ok: false as const, error: "not one of its options" };
      Object.assign(rec, { status: "decided", choice: answer.choice });
    } else if (answer.kind === "done") Object.assign(rec, { status: "done", choice: "" });
    else Object.assign(rec, { status: "later", choice: "", wake: localIso(now + LATER_DAYS * 86400e3) });
    if (answer.kind !== "later") delete rec.wake;
    Object.assign(rec, { note: line(note, 300), decided_at: stamp });
    const tmp = `${files.items}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(doc, null, 1) + "\n", { mode: 0o644 });
    await rename(tmp, files.items);
    const out = parseOne(rec)!;
    const log = { id: out.id, status: out.status, choice: out.choice, note: out.note, decided_at: out.decided_at, ...(out.wake ? { wake: out.wake } : {}), text: out.text };
    await appendFile(/*turbopackIgnore: true*/ files.log, JSON.stringify(log) + "\n");
    return { ok: true as const, item: out };
  });
}

/** The box's lists, read fresh (an answer shows at once). */
export async function ownerDecisions(now = Date.now()): Promise<{ open: Decision[]; decided: Decision[] }> {
  const text = await readFile(/*turbopackIgnore: true*/ FILES.items, "utf8").catch(() => "");
  return partition(parseItems(text), now);
}
