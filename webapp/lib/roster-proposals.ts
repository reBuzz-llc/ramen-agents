// The CEO's roster proposals (creatorCC queue 440 on valiCC's 439 design, owner 11-11: the CEO is the family's alpha,
// every roster change goes through the owner). The engine records them open in
// common-data/shared-state/ceo-proposals.json: {id, ts, bot, change: {kind: "roster", action: start | stop | rename |
// create | retire, new_name (rename), slug, name, role, template, persona {heading: text}, goal, rules, expected_calls_day
// (create)}, reason, goal_served, resource_sheet: {member: {calls_yesterday, tokens_yesterday, estimate}, family:
// {allowance_pct_yesterday}, mac: {free_gb, swap_used_gb}, after_pct, line}, status "open"}.
// The owner decides here. Under "ceo-proposals.json.lock" (mkdir; broken after 30 s) the record gets status approved or
// declined, owner_note and decided_at, all in one write (the engine tells the CEO each verdict once, note included).
// Then an approved start or stop runs the owner's own start/stop path (owner-controls.jsonl gets via "approval in the
// Decisions box, proposal <id>") and the record gets status applied or failed, applied_at and apply_result; rename,
// create and retire run `scripts/roster_apply.py <id>`, which writes those itself. At approval of a create the owner may
// edit the name, the goal and the persona text (owner_edited lists which; an edited goal is the owner's); role,
// template, slug and rules are not editable (a change there is a Decline with a note). valiCC may expire an open one
// after 7 days (status expired, expired_at, expired_note).
// Node imports only, so the test runs with Node's own runner.
import { mkdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type RosterAction = "start" | "stop" | "rename" | "create" | "retire";
export type RosterStatus = "open" | "approved" | "declined" | "applied" | "failed" | "expired";
export type Sheet = {
  line: string;
  tokensYesterday: number | null;
  callsYesterday: number | null;
  estimate: boolean;
  familyPct: number | null;
  afterPct: number | null;
  freeGb: number | null;
  swapGb: number | null;
};
export type CreateDraft = { slug: string; name: string; role: string; template: string; persona: [string, string][]; goal: string; rules: string[]; expectedCalls: number | null };
export type RosterProposal = {
  id: string;
  ts: string;
  bot: string;
  action: RosterAction;
  newName: string;
  create: CreateDraft | null;
  reason: string;
  goalServed: string;
  sheet: Sheet;
  status: RosterStatus;
  ownerNote: string;
  decidedAt: string; // for an expired one, its expired_at
  appliedAt: string;
  applyResult: string;
  expiredNote: string;
};
export type Files = { proposals: string };
export type Edits = { name?: string; goal?: string; persona?: Record<string, string> };
/** What runs an approved change: the owner's start/stop path and the roster applier. Both answer with a result line. */
export type Appliers = {
  startStop: (slug: string, action: "start" | "stop", via: string, note: string) => Promise<{ ok: boolean; text: string }>;
  roster: (id: string) => Promise<{ ok: boolean; text: string }>;
};

const LOCK_STALE_MS = 30_000;
const KEEP_DECIDED_DAYS = 7;
const ACTIONS: RosterAction[] = ["start", "stop", "rename", "create", "retire"];
const STATUSES: RosterStatus[] = ["open", "approved", "declined", "applied", "failed", "expired"];
const MAX_NAME = 40;
const MAX_GOAL = 200;
const MAX_PERSONA = 1500;
const NAME_OK = /^[A-Za-z0-9 &-]{2,40}$/;
const BOTS = process.env.BOTS_DIR ?? path.join(process.env.HOME ?? "", "bots");
const FILES: Files = { proposals: path.join(BOTS, "common-data", "shared-state", "ceo-proposals.json") };

const line = (v: unknown, max = 600) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\r\n/g, "\n").trim().slice(0, max) : "");
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/** The record's change is a roster one: the step-one proposals list and the CEO changes leave these out. */
export const isRoster = (raw: unknown) => obj(obj(raw).change).kind === "roster";

function sheetOf(raw: unknown): Sheet {
  const s = obj(raw);
  const m = obj(s.member);
  const mac = obj(s.mac);
  return {
    line: line(s.line, 300),
    tokensYesterday: num(m.tokens_yesterday),
    callsYesterday: num(m.calls_yesterday),
    estimate: m.estimate === true,
    familyPct: num(obj(s.family).allowance_pct_yesterday),
    afterPct: num(s.after_pct),
    freeGb: num(mac.free_gb),
    swapGb: num(mac.swap_used_gb),
  };
}

function createOf(c: Record<string, unknown>): CreateDraft {
  const persona = Object.entries(obj(c.persona))
    .map(([h, t]) => [line(h, 80), text(t, MAX_PERSONA)] as [string, string])
    .filter(([h]) => h);
  const rules = (Array.isArray(c.rules) ? c.rules : []).map((r) => line(typeof r === "string" ? r : obj(r).text, 160)).filter(Boolean);
  return {
    slug: line(c.slug, 40),
    name: line(c.name, MAX_NAME),
    role: line(c.role, 600),
    template: line(c.template, 20),
    persona,
    goal: line(c.goal, MAX_GOAL),
    rules,
    expectedCalls: num(c.expected_calls_day),
  };
}

function parseOne(raw: unknown): RosterProposal | null {
  const r = obj(raw);
  const c = obj(r.change);
  if (c.kind !== "roster" || typeof r.id !== "string" || !r.id || typeof r.bot !== "string" || !r.bot) return null;
  const action = ACTIONS.find((a) => a === c.action);
  const status = STATUSES.find((s) => s === (r.status ?? "open"));
  if (!action || !status) return null;
  return {
    id: r.id,
    ts: line(r.ts, 40),
    bot: r.bot,
    action,
    newName: action === "rename" ? line(c.new_name, MAX_NAME) : "",
    create: action === "create" ? createOf(c) : null,
    reason: line(r.reason),
    goalServed: line(r.goal_served, 200),
    sheet: sheetOf(r.resource_sheet),
    status,
    ownerNote: line(r.owner_note, 300),
    decidedAt: line(status === "expired" ? r.expired_at : r.decided_at, 40),
    appliedAt: line(r.applied_at, 40),
    applyResult: line(r.apply_result, 400),
    expiredNote: status === "expired" ? line(r.expired_note) : "",
  };
}

/** The roster proposals in the file's text, oldest first. */
export function parseRoster(textIn: string): RosterProposal[] {
  try {
    const doc = obj(JSON.parse(textIn));
    return Array.isArray(doc.proposals) ? doc.proposals.map(parseOne).filter((p): p is RosterProposal => p !== null) : [];
  } catch {
    return [];
  }
}

/** Open ones oldest first; the rest decided in the last 7 days, newest first. */
export function rosterBoard(list: RosterProposal[], now: number): { open: RosterProposal[]; decided: RosterProposal[] } {
  const since = localIso(now - KEEP_DECIDED_DAYS * 86400e3);
  return {
    open: list.filter((p) => p.status === "open"),
    decided: list.filter((p) => p.status !== "open" && p.decidedAt >= since).sort((a, b) => (a.decidedAt < b.decidedAt ? 1 : -1)),
  };
}

export async function readRoster(files: Files = FILES, now = Date.now()) {
  return rosterBoard(await readFile(/*turbopackIgnore: true*/ files.proposals, "utf8").then(parseRoster, () => []), now);
}

/** "Start Scout", "Rename Scout to Pathfinder", "Create Site Checker" with the member's shown name. */
export function rosterWords(p: RosterProposal, name: string): string {
  if (p.action === "rename") return `Rename ${name} to ${p.newName || "(no name)"}`;
  if (p.action === "create") return `Create ${p.create?.name || p.bot}${p.create?.template ? ` (${p.create.template})` : ""}`;
  return `${p.action[0].toUpperCase()}${p.action.slice(1)} ${name}`;
}

/** The status in a word for the decided list. */
export function statusWord(p: RosterProposal): string {
  return { open: "Open", approved: "Approved", declined: "Declined", applied: "Approved, applied", failed: "Approved, failed", expired: "Expired" }[p.status];
}

// ---- the decision ---------------------------------------------------------------------------------------------------------
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
      else if (i > 100) throw new Error("the proposals file is locked; try again in a moment");
      else await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    await rmdir(/*turbopackIgnore: true*/ lock).catch(() => {});
  }
}

function indentOf(t: string): number {
  const second = t.split("\n")[1];
  return second === undefined ? 1 : Math.max(1, second.length - second.trimStart().length);
}

async function writeAtomic(file: string, t: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, t, { mode: 0o644 });
  await rename(tmp, file);
}

type Doc = Record<string, unknown>;
/** Change one record under the lock; `fn` returns an error, or the record's new fields. */
async function update(files: Files, id: string, fn: (rec: Doc, p: RosterProposal) => string | Doc): Promise<{ ok: true; proposal: RosterProposal } | { ok: false; error: string }> {
  return withLock(files.proposals, async () => {
    let raw: string;
    let doc: Doc;
    try {
      raw = await readFile(/*turbopackIgnore: true*/ files.proposals, "utf8");
      doc = JSON.parse(raw);
    } catch {
      return { ok: false as const, error: "the proposals file could not be read" };
    }
    const raws = Array.isArray(doc.proposals) ? (doc.proposals as unknown[]) : [];
    const at = raws.findIndex((r) => obj(r).id === id);
    const p = at >= 0 ? parseOne(raws[at]) : null;
    if (!p) return { ok: false as const, error: "no such roster proposal" };
    const out = fn(raws[at] as Doc, p);
    if (typeof out === "string") return { ok: false as const, error: out };
    const rec = { ...(raws[at] as Doc), ...out };
    raws[at] = rec;
    doc.proposals = raws;
    await writeAtomic(files.proposals, JSON.stringify(doc, null, indentOf(raw)) + "\n");
    return { ok: true as const, proposal: parseOne(rec)! };
  });
}

/** The owner's edits to a create, checked; the change's new fields and which were edited, or why not. */
export function applyEdits(change: Doc, edits: Edits): { change: Doc; edited: string[] } | string {
  const next: Doc = { ...change };
  const edited: string[] = [];
  if (edits.name !== undefined) {
    const n = line(edits.name, 80);
    if (!NAME_OK.test(n)) return "a name is 2 to 40 letters, digits, spaces, & or -";
    if (n !== line(change.name, MAX_NAME)) {
      next.name = n;
      edited.push("name");
    }
  }
  if (edits.goal !== undefined) {
    const g = line(edits.goal, 400);
    if (!g) return "the goal cannot be empty";
    if (g.length > MAX_GOAL) return `keep the goal under ${MAX_GOAL} characters`;
    if (g !== line(change.goal, MAX_GOAL)) {
      next.goal = g;
      edited.push("goal");
    }
  }
  if (edits.persona) {
    const persona = { ...obj(change.persona) } as Record<string, unknown>;
    for (const [h, t] of Object.entries(edits.persona)) {
      if (!(h in persona)) return `the persona has no section "${h}"`;
      const body = text(t, MAX_PERSONA + 1);
      if (!body) return `the section "${h}" cannot be empty`;
      if (body.length > MAX_PERSONA) return `keep "${h}" under ${MAX_PERSONA} characters`;
      if (/^#{1,2} /m.test(body)) return `"${h}" cannot hold a heading of its own`;
      if (body !== text(persona[h], MAX_PERSONA)) {
        persona[h] = body;
        edited.push(`persona:${h}`);
      }
    }
    next.persona = persona;
  }
  return { change: next, edited };
}

export type DecideResult = { ok: true; proposal: RosterProposal; text: string } | { ok: false; error: string };

/** Approve (and apply) or decline one open roster proposal: see the header. */
export async function decideRoster(
  id: string,
  approve: boolean,
  note: string,
  edits: Edits,
  appliers: Appliers,
  files: Files = FILES,
  now = Date.now(),
): Promise<DecideResult> {
  const ownerNote = line(note, 300);
  const decided = await update(files, id, (rec, p) => {
    if (p.status !== "open") return `already ${p.status}`;
    const out: Doc = { status: approve ? "approved" : "declined", decided_at: localIso(now) };
    if (ownerNote) out.owner_note = ownerNote;
    if (approve && p.action === "create" && (edits.name !== undefined || edits.goal !== undefined || edits.persona)) {
      const e = applyEdits(obj(rec.change), edits);
      if (typeof e === "string") return e;
      if (e.edited.length) Object.assign(out, { change: e.change, owner_edited: e.edited });
    }
    return out;
  });
  if (!decided.ok || !approve) return decided.ok ? { ...decided, text: "Declined." } : decided;
  const p = decided.proposal;
  if (p.action === "start" || p.action === "stop") {
    let res: { ok: boolean; text: string };
    try {
      res = await appliers.startStop(p.bot, p.action, `approval in the Decisions box, proposal ${p.id}`, ownerNote);
    } catch (err) {
      res = { ok: false, text: err instanceof Error ? err.message : String(err) };
    }
    const done = await update(files, id, () => ({ status: res.ok ? "applied" : "failed", applied_at: localIso(Date.now()), apply_result: res.text.slice(0, 500) }));
    return done.ok ? { ok: true, proposal: done.proposal, text: res.text } : done;
  }
  let res: { ok: boolean; text: string };
  try {
    res = await appliers.roster(p.id);
  } catch (err) {
    res = { ok: false, text: err instanceof Error ? err.message : String(err) };
  }
  // roster_apply.py writes applied/failed itself; when it could not run at all, say so on the record
  const after = await readFile(/*turbopackIgnore: true*/ files.proposals, "utf8").then(parseRoster, () => []);
  const now2 = after.find((x) => x.id === id) ?? p;
  if (now2.status === "approved" && !res.ok) {
    const failed = await update(files, id, () => ({ status: "failed", applied_at: localIso(Date.now()), apply_result: `the roster applier did not run: ${res.text}`.slice(0, 500) }));
    return failed.ok ? { ok: true, proposal: failed.proposal, text: res.text } : failed;
  }
  return { ok: true, proposal: now2, text: res.text };
}
