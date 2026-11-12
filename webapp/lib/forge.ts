// The Forge (creatorCC queues 477/478, valiCC's design): a member asks for a resource or a feature it lacks with the
// engine's `wish` action, one line in common-data/shared-state/forge.jsonl; the owner decides in the Decisions box (Build /
// Later / No with a note), which appends a decision line; Build also appends a line to forge-queue.md for creatorCC;
// creatorCC marks "done" by hand when it lands. The file is append-only and read by folding the lines by id, newest last.
// Each write here is one line in one O_APPEND write (under 4 KB), atomic against the Python writers without a lock (agreed
// with valiCC; their fcntl lock file forge.jsonl.lock is left alone). Self-contained for the node tests.
import { appendFile, readFile } from "node:fs/promises";

export type WishStatus = "open" | "build" | "later" | "no" | "done";
export type Wish = {
  id: string; ts: string; bot: string; for: string; what: string; why: string; keyResult: string;
  status: WishStatus; decidedAt: string; note: string; by: string;
};

const STATUSES: WishStatus[] = ["open", "build", "later", "no", "done"];
const ID = /^w-\d{8}-\d{6}-[a-z0-9-]{1,40}$/;
const str = (v: unknown, n = 200) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");

/** Fold the file's lines by id, newest last: a wish line starts a wish; a decision or event line changes its status. */
export function foldForge(text: string): Wish[] {
  const out = new Map<string, Wish>();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const id = str(o.id, 80);
    if (!ID.test(id)) continue;
    const cur = out.get(id);
    if (!cur) {
      if (!str(o.what)) continue; // a decision for a wish this file does not have
      out.set(id, {
        id, ts: str(o.ts, 30), bot: str(o.bot, 60), for: str(o.for, 60) || str(o.bot, 60), what: str(o.what), why: str(o.why), keyResult: str(o.key_result),
        status: STATUSES.includes(o.status as WishStatus) ? (o.status as WishStatus) : "open", decidedAt: "", note: "", by: "",
      });
      continue;
    }
    if (STATUSES.includes(o.status as WishStatus)) {
      cur.status = o.status as WishStatus;
      cur.decidedAt = str(o.decided_at, 30) || str(o.ts, 30) || cur.decidedAt;
      cur.note = str(o.note, 300);
      cur.by = str(o.by, 60);
    }
  }
  return [...out.values()];
}

export type ForgeBoard = { open: Wish[]; building: Wish[]; later: Wish[]; built: Wish[]; declined: Wish[] };
/** The box's lists: open oldest first (the longest waiting on top); the rest newest decision first, built in 30 days. */
export function forgeBoard(wishes: Wish[], now = new Date()): ForgeBoard {
  const by = (s: WishStatus) => wishes.filter((w) => w.status === s).sort((a, b) => b.decidedAt.localeCompare(a.decidedAt));
  const month = new Date(now.getTime() - 30 * 86400_000).toISOString().slice(0, 19);
  return {
    open: wishes.filter((w) => w.status === "open").sort((a, b) => a.ts.localeCompare(b.ts)),
    building: by("build"), later: by("later"), built: by("done").filter((w) => w.decidedAt >= month), declined: by("no").filter((w) => w.decidedAt >= month),
  };
}

/** "3 h", "2 d": how long a wish has waited. */
export function age(ts: string, now = new Date()): string {
  const ms = now.getTime() - new Date(ts).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "";
  const h = Math.floor(ms / 3600_000);
  return h < 1 ? `${Math.max(1, Math.floor(ms / 60_000))} min` : h < 48 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);

/** The owner's decision as the file's line, and Build's line for forge-queue.md, or the reason it is refused. */
export function decisionLines(w: Wish | undefined, status: string, noteRaw: string, now = new Date(), memberName = ""):
  { line: string; queue: string | null } | string {
  if (!w) return "no such wish";
  if (status !== "build" && status !== "later" && status !== "no") return "the decision is build, later or no";
  if (w.status !== "open" && w.status !== "later") return `this wish is already ${w.status === "build" ? "building" : w.status}`;
  const note = str(noteRaw, 300);
  if (status === "no" && !note) return "say why in a short note: the member reads it";
  const line = JSON.stringify({ id: w.id, status, decided_at: local(now), note, by: "owner" });
  const queue = status === "build"
    ? `- ${local(now).slice(0, 10)} ${memberName || w.for}: ${w.what}${w.why ? ` -- ${w.why}` : ""}${w.keyResult ? ` (${w.keyResult})` : ""} [wish ${w.id}]${note ? `: ${note}` : ""}`
    : null;
  return { line, queue };
}

export async function readForge(file: string): Promise<Wish[]> {
  try {
    return foldForge(await readFile(/*turbopackIgnore: true*/ file, "utf8"));
  } catch {
    return [];
  }
}

/** One line appended in one write (O_APPEND): atomic against the other appenders for a line under 4 KB. */
export async function appendLine(file: string, line: string): Promise<void> {
  const text = `${line.replace(/\n/g, " ")}\n`;
  if (Buffer.byteLength(text) > 4000) throw new Error("the line is too long to append in one write");
  await appendFile(/*turbopackIgnore: true*/ file, text, { encoding: "utf8", flag: "a" });
}
