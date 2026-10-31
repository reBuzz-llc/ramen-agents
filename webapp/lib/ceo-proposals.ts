// The CEO's proposals (2026-10-30, step one of the CEO steering plan): The CEO proposes a change to
// one bot's line in the owner's work plan (its goal, or a rule added or dropped); the owner approves or declines it on
// the dashboard. Nothing is applied without the owner.
//   common-data/shared-state/ceo-proposals.json = {version: 1, proposals: [...]}, oldest first. The engine only appends
//   open proposals (and may add a validator_note to an open one); this app is the only writer of status, owner_note and
//   decided_at, and on Approve the only writer of common-data/work-plan.json, with one line per applied change in
//   shared-state/ceo-proposals-applied.jsonl ({id, bot, before, after, ts}) so it can be reverted by hand.
// Two writers share the file, so every read-modify-write holds the lock directory "ceo-proposals.json.lock" (mkdir is
// atomic in Node and Python alike; a lock older than 30 s is broken). Unknown fields are kept.
// Node imports only, so the test runs with Node's own runner.
import { appendFile, mkdir, readFile, rename, rmdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type Change = { kind: "goal"; text: string } | { kind: "add_rule"; text: string } | { kind: "drop_rule"; rule_id: string; text: string };
export type Proposal = {
  id: string;
  ts: string;
  bot: string;
  change: Change | null; // null: a shape this app does not know; shown, never applied
  reason: string;
  metric: string;
  expected: string;
  status: "open" | "approved" | "declined";
  validator_note: string;
  owner_note: string;
  decided_at: string;
};
type Rule = { id: string; text: string };
type Plan = { goal: string; rules: Rule[] };
type Files = { proposals: string; plan: string; applied: string };

// As the work-plan editor (lib/work-plan.ts; not imported: Node's test runner needs ".ts" on a relative import).
const MAX_GOAL = 200;
const MAX_RULE = 160;
const MAX_RULES = 8;
const LOCK_STALE_MS = 30_000;
const KEEP_DECIDED_DAYS = 7;

const BOTS = process.env.BOTS_DIR ?? path.join(process.env.HOME ?? "", "bots");
const FILES: Files = {
  proposals: path.join(BOTS, "common-data", "shared-state", "ceo-proposals.json"),
  plan: path.join(BOTS, "common-data", "work-plan.json"),
  applied: path.join(BOTS, "common-data", "shared-state", "ceo-proposals-applied.jsonl"),
};

const line = (v: unknown, max = 600) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function parseChange(raw: unknown): Change | null {
  const c = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const text = line(c.text);
  if (c.kind === "goal" && text) return { kind: "goal", text };
  if (c.kind === "add_rule" && text) return { kind: "add_rule", text };
  if (c.kind === "drop_rule" && /^r\d{1,4}$/.test(String(c.rule_id))) return { kind: "drop_rule", rule_id: String(c.rule_id), text };
  return null;
}

function parseOne(raw: unknown): Proposal | null {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  if (!r || typeof r.id !== "string" || !r.id || typeof r.bot !== "string" || !r.bot) return null;
  const status = r.status === "approved" || r.status === "declined" ? r.status : "open";
  return {
    id: r.id,
    ts: line(r.ts, 40),
    bot: r.bot,
    change: parseChange(r.change),
    reason: line(r.reason),
    metric: line(r.metric),
    expected: line(r.expected),
    status,
    validator_note: line(r.validator_note),
    owner_note: line(r.owner_note),
    decided_at: line(r.decided_at, 40),
  };
}

/** The proposals in the file's text, oldest first; malformed records are skipped. */
export function parseProposals(text: string): Proposal[] {
  try {
    const doc = JSON.parse(text) as { proposals?: unknown };
    return Array.isArray(doc.proposals) ? doc.proposals.map(parseOne).filter((p): p is Proposal => p !== null) : [];
  } catch {
    return [];
  }
}

type Board = { open: Proposal[]; decided: Proposal[] };

/** Open proposals oldest first; decided ones from the last 7 days, newest decision first. */
export function board(list: Proposal[], now: number): Board {
  const since = localIso(now - KEEP_DECIDED_DAYS * 86400e3);
  return {
    open: list.filter((p) => p.status === "open"),
    decided: list.filter((p) => p.status !== "open" && p.decided_at >= since).sort((a, b) => (a.decided_at < b.decided_at ? 1 : -1)),
  };
}

export async function readBoard(files: Files = FILES, now = Date.now()): Promise<Board> {
  return board(await readFile(/*turbopackIgnore: true*/ files.proposals, "utf8").then(parseProposals, () => []), now);
}

/** "Lead Gen: goal → …" style one-liner for a change. */
export function describe(c: Change | null): string {
  if (!c) return "a change this dashboard cannot read";
  if (c.kind === "goal") return `New goal: ${c.text}`;
  if (c.kind === "add_rule") return `Add rule: ${c.text}`;
  return `Drop rule ${c.rule_id}${c.text ? `: ${c.text}` : ""}`;
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

async function writeAtomic(file: string, text: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, text, { mode: 0o644 });
  await rename(tmp, file);
}

function planOf(raw: unknown): Plan {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const rules: Rule[] = [];
  for (const x of Array.isArray(r.rules) ? r.rules : []) {
    const text = line(typeof x === "string" ? x : (x as Rule)?.text, MAX_RULE);
    const id = typeof x === "object" && x && /^r\d{1,4}$/.test(String((x as Rule).id)) ? String((x as Rule).id) : "";
    if (text && id) rules.push({ id, text });
  }
  return { goal: line(r.goal, MAX_GOAL), rules };
}

/** The bot's plan after the change, or the reason it cannot be applied. */
function applyChange(before: Plan, c: Change | null): Plan | string {
  if (!c) return "this dashboard does not know how to apply that change";
  if (c.kind === "goal") return { goal: c.text.slice(0, MAX_GOAL), rules: before.rules };
  if (c.kind === "add_rule") {
    if (before.rules.length >= MAX_RULES) return `this bot already has ${MAX_RULES} rules; drop one first`;
    const next = Math.max(0, ...before.rules.map((r) => Number(r.id.slice(1)))) + 1;
    return { goal: before.goal, rules: [...before.rules, { id: `r${next}`, text: c.text.slice(0, MAX_RULE) }] };
  }
  const rule = before.rules.find((r) => r.id === c.rule_id);
  if (!rule) return `rule ${c.rule_id} is no longer in this bot's work plan`;
  if (c.text && line(c.text, MAX_RULE).toLowerCase() !== rule.text.toLowerCase()) return `rule ${c.rule_id} was reworded since (now: "${rule.text}")`;
  return { goal: before.goal, rules: before.rules.filter((r) => r !== rule) };
}

type Decision = { ok: true; proposal: Proposal } | { ok: false; error: string };

/** Approve (apply to the work plan, log it) or decline one open proposal, with the owner's optional one-line note. */
export async function decide(id: string, approve: boolean, note: string, files: Files = FILES, now = Date.now()): Promise<Decision> {
  return withLock(files.proposals, async () => {
    let doc: { proposals?: unknown[] } & Record<string, unknown>;
    try {
      doc = JSON.parse(await readFile(/*turbopackIgnore: true*/ files.proposals, "utf8"));
    } catch {
      return { ok: false, error: "the proposals file could not be read" };
    }
    const raws = Array.isArray(doc.proposals) ? doc.proposals : [];
    const at = raws.findIndex((r) => (r as { id?: unknown })?.id === id);
    const p = at >= 0 ? parseOne(raws[at]) : null;
    if (!p) return { ok: false, error: "no such proposal" };
    if (p.status !== "open") return { ok: false, error: `already ${p.status}` };
    const ts = localIso(now);
    if (approve) {
      let plan: { bots?: Record<string, unknown> } & Record<string, unknown>;
      try {
        plan = JSON.parse(await readFile(/*turbopackIgnore: true*/ files.plan, "utf8"));
      } catch {
        plan = { version: 1, updatedAt: null, bots: {} };
      }
      const bots = plan.bots && typeof plan.bots === "object" ? plan.bots : (plan.bots = {});
      const before = planOf(bots[p.bot]);
      const after = applyChange(before, p.change);
      if (typeof after === "string") return { ok: false, error: after };
      bots[p.bot] = after;
      plan.updatedAt = new Date(now).toISOString();
      await writeAtomic(files.plan, JSON.stringify(plan, null, 1) + "\n");
      await appendFile(/*turbopackIgnore: true*/ files.applied, JSON.stringify({ id, bot: p.bot, before, after, ts }) + "\n");
    }
    const rec: Record<string, unknown> = { ...(raws[at] as Record<string, unknown>), status: approve ? "approved" : "declined", decided_at: ts };
    const n = line(note, 300);
    if (n) rec.owner_note = n;
    raws[at] = rec;
    doc.proposals = raws;
    await writeAtomic(files.proposals, JSON.stringify(doc, null, 1) + "\n");
    return { ok: true, proposal: parseOne(rec)! };
  });
}
