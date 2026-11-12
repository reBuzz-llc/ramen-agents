// The CEO's own changes (CEO self-steering step two; valiCC queue 411 from creatorCC's go, owner 11-10 17:35): since
// engine a5d7a66 The CEO applies a change inside its fence at once and records it in
// common-data/shared-state/ceo-proposals.json with status "applied": {id, ts, bot, change, field, before, after, reason,
// metric, expected, applied_at, undo_until}. The Validator may set status "reverted" (reverted_at, validator_note).
// The Decisions box lists them, newest first, with Undo while a change is still "applied" and before undo_until.
// Undo writes `before` back only when the live value still equals `after` (else "changed since: undo it by hand"), in
// one locked write per file, as the engine writes them: work-plan.json and daily-goals.json each under their own
// "<file>.lock" (mkdir; broken after 30 s), tmp + rename, each file keeping its own indent (1 and 2); then the record
// gets status "undone", undone_at and undone_by under "ceo-proposals.json.lock", which this undo holds throughout so a
// second click cannot undo twice. Members re-read work-plan.json on its mtime, so an Undo is live on their next cycle.
// Persona changes (creatorCC queue 440, engine b710883): field "persona:<section>", before and after the section's body
// (from its "## " heading line to the next "## " or "# " line, "### " kept inside) in ~/bots/<slug>/persona.md; Undo writes
// before back under "persona.md.lock" while the section still reads as after. Personas reload on mtime.
// Node imports only, so the test runs with Node's own runner.
import { appendFile, mkdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type Status = "applied" | "undone" | "reverted";
export type Part = "goal" | "rules" | "daily_goal" | "persona";
export type RuleValue = { id: string; text: string; by?: string } & Record<string, unknown>;
export type CeoChange = {
  id: string;
  ts: string;
  bot: string;
  kind: string;
  field: string;
  part: Part | null; // null: a field this dashboard cannot read (shown, never undone)
  section: string; // a persona change's heading ("How you work"), else ""
  before: unknown;
  after: unknown;
  reason: string;
  status: Status;
  applied_at: string;
  undo_until: string;
  undone_at: string;
  undone_by: string;
  reverted_at: string;
  validator_note: string;
};
export type Files = { proposals: string; plan: string; goals: string; applied: string; bots?: string };

const LOCK_STALE_MS = 30_000;
const STATUSES = new Set<Status>(["applied", "undone", "reverted"]);
const BOTS = process.env.BOTS_DIR ?? path.join(process.env.HOME ?? "", "bots");
const FILES: Files = {
  proposals: path.join(BOTS, "common-data", "shared-state", "ceo-proposals.json"),
  plan: path.join(BOTS, "common-data", "work-plan.json"),
  goals: path.join(BOTS, "common-data", "daily-goals.json"),
  applied: path.join(BOTS, "common-data", "shared-state", "ceo-proposals-applied.jsonl"),
  bots: BOTS,
};
const SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const CHANGED_SINCE = "changed since: undo it by hand";

const line = (v: unknown, max = 600) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

export function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** The part a record's field names, for its own bot only: "work-plan.json bots.<slug>.goal|rules", "daily-goals.json <slug>",
 *  "persona:<section>". */
export function partOf(field: string, bot: string): Part | null {
  if (/^persona:\S/.test(field)) return SLUG.test(bot) ? "persona" : null;
  const plan = /^work-plan\.json bots\.([\w-]+)\.(goal|rules)$/.exec(field);
  if (plan) return plan[1] === bot ? (plan[2] as Part) : null;
  const goals = /^daily-goals\.json ([\w-]+)$/.exec(field);
  return goals && goals[1] === bot ? "daily_goal" : null;
}

function parseOne(raw: unknown): CeoChange | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.id !== "string" || !r.id || typeof r.bot !== "string" || !r.bot || !STATUSES.has(r.status as Status)) return null;
  const change = r.change && typeof r.change === "object" ? (r.change as Record<string, unknown>) : {};
  if (change.kind === "roster") return null; // an applied roster proposal is listed with the roster proposals
  const field = line(r.field, 200);
  return {
    id: r.id,
    ts: line(r.ts, 40),
    bot: r.bot,
    kind: line(change.kind, 40),
    field,
    part: partOf(field, r.bot),
    section: field.startsWith("persona:") ? field.slice("persona:".length) : "",
    before: r.before ?? null,
    after: r.after ?? null,
    reason: line(r.reason),
    status: r.status as Status,
    applied_at: line(r.applied_at, 40) || line(r.ts, 40),
    undo_until: line(r.undo_until, 40),
    undone_at: line(r.undone_at, 40),
    undone_by: line(r.undone_by, 80),
    reverted_at: line(r.reverted_at, 40),
    validator_note: line(r.validator_note),
  };
}

/** The CEO's changes in the file's text (applied, undone or reverted), newest first; the step-one proposals are not. */
export function parseChanges(text: string): CeoChange[] {
  try {
    const doc = JSON.parse(text) as { proposals?: unknown };
    const list = Array.isArray(doc.proposals) ? doc.proposals.map(parseOne).filter((c): c is CeoChange => c !== null) : [];
    return list.sort((a, b) => (a.applied_at < b.applied_at ? 1 : a.applied_at > b.applied_at ? -1 : 0));
  } catch {
    return [];
  }
}

/** Undo is offered while the change is still applied, before its undo_until, on a field this dashboard can read. */
export function canUndo(c: CeoChange, now: number): boolean {
  return c.status === "applied" && c.part !== null && !!c.undo_until && localIso(now) < c.undo_until.slice(0, 19);
}

/** The ids that can be undone right now (the box reads the clock here, not while it renders). */
export function undoableNow(list: CeoChange[], now = Date.now()): Set<string> {
  return new Set(list.filter((c) => canUndo(c, now)).map((c) => c.id));
}

/** One side of the change as the line shows it: a rule's text, "(new rule)" for no before, "(dropped)" for no after. */
export function sideText(c: CeoChange, side: "before" | "after"): string {
  const v = c[side];
  if (c.part === "rules") {
    if (v === null || typeof v !== "object") return side === "before" ? "(new rule)" : "(dropped)";
    return line((v as RuleValue).text, 200) || "(a rule with no text)";
  }
  if (c.part === "daily_goal") return typeof v === "number" ? String(v) : "(none)";
  if (c.part === "persona") {
    const t = typeof v === "string" ? line(v, 2000) : "";
    return t ? (t.length > 160 ? `${t.slice(0, 159)}…` : t) : "(empty)";
  }
  return typeof v === "string" ? line(v, 200) || "(empty)" : v === null ? "(none)" : line(JSON.stringify(v), 200);
}

/** The field in plain words: "goal", "rules", "daily goal". */
export const PART_LABEL: Record<Part, string> = { goal: "goal", rules: "rules", daily_goal: "daily goal", persona: "persona" };

// ---- persona sections (as the engine's roster.sections) ---------------------------------------------------------------
/** [heading, body start, body end] per "## " section: the body runs to the next "## " or "# " line; "### " stays inside. */
export function personaSections(text: string): [string, number, number][] {
  const heads: [string, string, number, number][] = [];
  let pos = 0;
  for (const ln of text.split(/(?<=\n)/)) {
    const m = /^(#{1,2}) (.+?)\s*$/.exec(ln.replace(/\n$/, ""));
    if (m) heads.push([m[1], m[2], pos, pos + ln.length]);
    pos += ln.length;
  }
  return heads.flatMap(([level, name, , body], i) => (level === "##" ? [[name, body, i + 1 < heads.length ? heads[i + 1][2] : text.length] as [string, number, number]] : []));
}

/** The text with one section's body replaced, when its body still reads as `expect` (whitespace at the ends aside; null:
 *  whatever it reads); "missing" when the section is gone, "changed" when it reads otherwise. */
export function replaceSection(text: string, heading: string, expect: string | null, put: string): string | "missing" | "changed" {
  const hit = personaSections(text).find(([name]) => name === heading);
  if (!hit) return "missing";
  if (expect !== null && text.slice(hit[1], hit[2]).trim() !== expect.trim()) return "changed";
  return text.slice(0, hit[1]) + put + text.slice(hit[2]);
}

export async function readChanges(files: Files = FILES): Promise<CeoChange[]> {
  return readFile(/*turbopackIgnore: true*/ files.proposals, "utf8").then(parseChanges, () => []);
}

// ---- the undo ---------------------------------------------------------------------------------------------------------
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
      else if (i > 100) throw new Error(`${path.basename(file)} is locked; try again in a moment`);
      else await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    await rmdir(/*turbopackIgnore: true*/ lock).catch(() => {});
  }
}

/** The file's own indent, read from its second line (the engine's rule), else the given one. */
function indentOf(text: string, fallback: number): number {
  const second = text.split("\n")[1];
  if (second === undefined) return fallback;
  return Math.max(1, second.length - second.trimStart().length);
}

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, text, { mode: 0o644 });
  await rename(tmp, file);
}

/** Equal as JSON values, key order aside. */
export function same(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([x], [y]) => (x < y ? -1 : 1)).map(([k, x]) => [k, canon(x)])) : v;
  return JSON.stringify(canon(a ?? null)) === JSON.stringify(canon(b ?? null));
}

type Doc = Record<string, unknown>;
const ruleId = (v: unknown) => (v && typeof v === "object" ? String((v as RuleValue).id ?? "") : "");

/** Put `before` back in the plan or goals document when the live value is still `after`; false when it changed since. */
export function revert(c: CeoChange, doc: Doc): boolean {
  if (c.part === "daily_goal") {
    if (!same(doc[c.bot], c.after)) return false;
    if (c.before === null || c.before === undefined) delete doc[c.bot];
    else doc[c.bot] = c.before;
    return true;
  }
  const bots = (doc.bots && typeof doc.bots === "object" ? doc.bots : (doc.bots = {})) as Record<string, Doc>;
  const mine = (bots[c.bot] && typeof bots[c.bot] === "object" ? bots[c.bot] : (bots[c.bot] = { goal: "", rules: [] })) as Doc;
  if (c.part === "goal") {
    if (!same(mine.goal ?? "", c.after ?? "")) return false;
    mine.goal = typeof c.before === "string" ? c.before : "";
    return true;
  }
  const rules = Array.isArray(mine.rules) ? (mine.rules as unknown[]) : [];
  const id = ruleId(c.after) || ruleId(c.before);
  if (!id) return false;
  const at = rules.findIndex((r) => ruleId(r) === id);
  const live = at >= 0 ? rules[at] : null;
  if (!same(live, c.after)) return false;
  if (c.before === null) rules.splice(at, 1); // an added rule goes
  else if (c.after === null) rules.push(c.before); // a dropped rule comes back
  else rules[at] = c.before; // an edited rule gets its old text
  mine.rules = rules;
  return true;
}

export type UndoResult = { ok: true; change: CeoChange } | { ok: false; error: string };

/** Undo one applied change by the person named `by`: see the header for the rules. */
export async function undo(id: string, by: string, files: Files = FILES, now = Date.now()): Promise<UndoResult> {
  return withLock(files.proposals, async () => {
    let doc: { proposals?: unknown[] } & Doc;
    let text: string;
    try {
      text = await readFile(/*turbopackIgnore: true*/ files.proposals, "utf8");
      doc = JSON.parse(text);
    } catch {
      return { ok: false as const, error: "the proposals file could not be read" };
    }
    const raws = Array.isArray(doc.proposals) ? doc.proposals : [];
    const at = raws.findIndex((r) => (r as { id?: unknown })?.id === id);
    const c = at >= 0 ? parseOne(raws[at]) : null;
    if (!c) return { ok: false as const, error: "no such CEO change" };
    if (c.status !== "applied") return { ok: false as const, error: `already ${c.status}` };
    if (!c.part) return { ok: false as const, error: `this dashboard cannot undo a change to "${c.field}"` };
    if (!canUndo(c, now)) return { ok: false as const, error: "the seven days to undo it are over" };
    const stamp = localIso(now);
    if (c.part === "persona") {
      const changed = await undoPersona(c, files.bots ?? BOTS);
      if (changed) return { ok: false as const, error: changed };
      return finish(c, raws, at, doc, text, by, stamp, files);
    }
    const target = c.part === "daily_goal" ? files.goals : files.plan;
    const changed = await withLock(target, async () => {
      let raw: string;
      let live: Doc;
      try {
        raw = await readFile(/*turbopackIgnore: true*/ target, "utf8");
        live = JSON.parse(raw);
      } catch {
        return `${path.basename(target)} could not be read`;
      }
      if (!revert(c, live)) return CHANGED_SINCE;
      if (c.part !== "daily_goal") live.updatedAt = stamp;
      await writeAtomic(target, JSON.stringify(live, null, indentOf(raw, c.part === "daily_goal" ? 2 : 1)) + "\n");
      return "";
    });
    if (changed) return { ok: false as const, error: changed };
    return finish(c, raws, at, doc, text, by, stamp, files);
  });
}

/** The record marked undone and the applied log's line (under the proposals lock, which the caller holds). */
async function finish(c: CeoChange, raws: unknown[], at: number, doc: Doc, text: string, by: string, stamp: string, files: Files): Promise<UndoResult> {
  const rec: Doc = { ...(raws[at] as Doc), status: "undone", undone_at: stamp, undone_by: line(by, 80) || "the owner" };
  raws[at] = rec;
  doc.proposals = raws;
  await writeAtomic(files.proposals, JSON.stringify(doc, null, indentOf(text, 1)) + "\n");
  await appendFile(/*turbopackIgnore: true*/ files.applied, JSON.stringify({ id: c.id, bot: c.bot, by: rec.undone_by, field: c.field, before: c.after, after: c.before, at: stamp, undo: true }) + "\n").catch(() => {});
  return { ok: true as const, change: parseOne(rec)! };
}

/** Write a persona section's `before` back under persona.md.lock; "" when done, else why not. */
async function undoPersona(c: CeoChange, bots: string): Promise<string> {
  if (!SLUG.test(c.bot) || !c.section) return "this dashboard cannot undo that persona change";
  if (typeof c.before !== "string" || typeof c.after !== "string") return "the record has no before and after text";
  return writeSection(path.join(bots, c.bot, "persona.md"), c.section, c.after, c.before);
}

/** Replace one persona section's body with `put` while it still reads as `expect` (null: in any case), under
 *  "<file>.lock"; "" when done. */
export async function writeSection(file: string, heading: string, expect: string | null, put: string): Promise<string> {
  return withLock(file, async () => {
    let text: string;
    try {
      text = await readFile(/*turbopackIgnore: true*/ file, "utf8");
    } catch {
      return `${path.basename(path.dirname(file))}/persona.md could not be read`;
    }
    const next = replaceSection(text, heading, expect, put);
    if (next === "missing") return `the section "${heading}" is no longer in the persona`;
    if (next === "changed") return CHANGED_SINCE;
    await writeAtomic(file, next);
    return "";
  });
}
