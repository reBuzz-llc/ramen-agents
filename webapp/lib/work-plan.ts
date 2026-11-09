// Server-side only: the Work plan page. One grid of every agent with:
//   - its current checklist, written by the engine to <bot>/workspace/plan.json (read-only here);
//   - the owner's future goal and current rules for it, one line each, in common-data/work-plan.json, which this
//     app writes and the engine reads into every decide prompt ("## The owner's work plan");
//   - today's score: accepted outputs against the tokens the bot spent, from model_calls.json and its actions table.
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BotProfile } from "./bot";
import { BOTS_DIR } from "./bots";
import { workspaceDir } from "./control";
import { dbPath, query, type Row } from "./episodes";
import { readPersona } from "./persona";
import { capabilitiesOf, type Capabilities } from "./capabilities";
import { fillTarget, readTarget } from "./target";
import { localIso, sq } from "./summary";
import { kindOf, reasonLabel, type Case, type Kind } from "./checks";

const MAX_GOAL = 200;
const MAX_RULE = 160;
const MAX_RULES = 8;

const PLAN_FILE = path.join(BOTS_DIR, "common-data", "work-plan.json");
const CALLS_FILE = path.join(BOTS_DIR, "common-data", "shared-state", "model_calls.json");
// The Validator's findings, keyed by fingerprint ({bot, status, severity, ...}); rewritten atomically each run.
const FLAGS_FILE = path.join(BOTS_DIR, "validator", "workspace", "flags.json");
// Actions that leave something behind for the business; notes and searches are the bot's own working.
const OUTPUT_TYPES = ["lead", "update_lead", "task", "update_task", "package", "publish_package", "provider"];

// Each rule keeps a stable id (r1, r2, ...) so a reworded rule is still the same rule to the Validator's checks.
export type Rule = { id: string; text: string };
export type OwnerPlan = { goal: string; rules: Rule[] };
// Time on a job is WORKING time: the gaps between the bot's own actions, each capped at IDLE_CAP_MIN, so a night with
// the Mac off or the bots paused for a game does not count. Estimates are the bot's own, written with the plan
// (plan.json "estimate_min", per step too) -- absent until the engine writes them.
type PlanStep = {
  text: string;
  done: boolean;
  doneAt: string | null;
  estimateMin: number | null;
  spentMin: number | null;
  activeMin: number | null; // the engine's active minutes on this step (macBot1 2d43ea0), null before it writes them
  actionsEngine: number | null;
};
export type BotPlan = {
  task: string;
  source: string;
  doneWhen: string;
  steps: PlanStep[];
  status: string;
  started: string | null;
  updated: string | null;
  estimateMin: number | null;
  spentMin: number; // working minutes since the plan started (until it ended, when done or stuck)
  actions: number; // the bot's actions in that time
  note: string; // why it ended stuck (the bot's reason, or the engine's overrun note)
  // The engine's own measures (macBot1 2d43ea0, refreshed once a cycle): active minutes (gaps capped at twice the
  // cycle), actions, and active minutes to the first ticked step (null until a step is ticked). Null before it writes them.
  activeMin: number | null;
  actionsEngine: number | null;
  firstStepMin: number | null;
  measured: boolean;
  workedSince: number; // accepted actions after a done or stuck plan ended: the bot moved on, the plan is history
};

const IDLE_CAP_MIN = 5;
export type Score = { outputs: number; refused: number; allowed: number; tokens: number | null; perMillion: number | null };
export type Flags = { errors: number; warns: number };
export type WorkCard = {
  slug: string;
  name: string;
  handle: string;
  plan: BotPlan | null;
  owner: OwnerPlan;
  personaGoal: string;
  selfGoal: string; // the goal the agent set for itself (workspace/self_goal.md), when it keeps one
  flags: Flags; // the Validator's open findings on this agent's outputs
  capabilities: Capabilities; // what it can and cannot do, from its config (the back of its card)
  score: Score;
  stopped: boolean; // the owner's STOP file is there: the page folds these away
};

type PlanDoc = { version: 1; updatedAt: string | null; bots: Record<string, OwnerPlan> };

const line = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

function cleanOwner(raw: unknown, previous?: OwnerPlan): OwnerPlan {
  const r = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const used = new Set<string>();
  let next = Math.max(0, ...[...(previous?.rules ?? []), ...(Array.isArray(r.rules) ? r.rules : [])].map((x) => {
    const m = /^r(\d{1,4})$/.exec(String((x as Rule)?.id ?? ""));
    return m ? Number(m[1]) : 0;
  }));
  const rules: Rule[] = [];
  for (const x of Array.isArray(r.rules) ? r.rules : []) {
    // Accept {id, text} or a bare string (a hand-edited file); a missing or repeated id gets the next free one.
    const text = line(typeof x === "string" ? x : (x as Rule)?.text, MAX_RULE);
    if (!text) continue;
    let id = typeof x === "object" && x && /^r\d{1,4}$/.test(String((x as Rule).id)) ? String((x as Rule).id) : "";
    if (!id || used.has(id)) id = `r${++next}`;
    used.add(id);
    rules.push({ id, text });
    if (rules.length >= MAX_RULES) break;
  }
  return { goal: line(r.goal, MAX_GOAL), rules };
}

async function readOwnerPlans(): Promise<PlanDoc> {
  try {
    const raw = JSON.parse(await readFile(/*turbopackIgnore: true*/ PLAN_FILE, "utf8")) as { updatedAt?: unknown; bots?: unknown };
    const bots: Record<string, OwnerPlan> = {};
    if (raw.bots && typeof raw.bots === "object") for (const [slug, v] of Object.entries(raw.bots)) bots[slug] = cleanOwner(v);
    return { version: 1, updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null, bots };
  } catch {
    return { version: 1, updatedAt: null, bots: {} };
  }
}

/** Save one bot's goal and rules; the rest of the file is kept. Atomic, with a unique temp name per save. */
export async function writeOwnerPlan(slug: string, raw: unknown): Promise<OwnerPlan> {
  const doc = await readOwnerPlans();
  const plan = cleanOwner(raw, doc.bots[slug]);
  doc.bots[slug] = plan;
  doc.updatedAt = new Date().toISOString();
  await mkdir(path.dirname(PLAN_FILE), { recursive: true });
  const tmp = `${PLAN_FILE}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(doc, null, 1) + "\n", { mode: 0o644 });
  await rename(tmp, PLAN_FILE);
  return plan;
}

const minutes = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : null);

/** Accepted actions after a stamp: a bot that kept working after its plan ended has moved on from it. */
async function acceptedSince(bot: BotProfile, after: string): Promise<number> {
  try {
    const rows = await query(await dbPath(bot), `SELECT COUNT(*) AS n FROM actions WHERE ts > ${sq(after)} AND verdict = 'allowed'`);
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

/** The bot's action times (ms) between two local ISO stamps. */
async function actionTimes(bot: BotProfile, from: string, to: string): Promise<number[]> {
  try {
    const rows = await query(await dbPath(bot), `SELECT ts FROM actions WHERE ts >= ${sq(from)} AND ts <= ${sq(to)} ORDER BY id`);
    return rows.map((r) => new Date(String(r.ts)).getTime()).filter(Number.isFinite);
  } catch {
    return [];
  }
}

/** Working minutes between two stamps: the sum of gaps between consecutive actions (and from the start to the first),
 * each capped at IDLE_CAP_MIN so time the bot was off, paused or waiting does not count. */
function workMinutes(stamps: number[], from: string, to: string): number {
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  const cap = IDLE_CAP_MIN * 60000;
  let prev = a;
  let ms = 0;
  for (const t of stamps) {
    if (t <= a || t > b) continue;
    ms += Math.min(t - prev, cap);
    prev = t;
  }
  return Math.round(ms / 60000);
}

/** The checklist the engine keeps for the bot's current job, or null before it writes one. */
async function readBotPlan(bot: BotProfile): Promise<BotPlan | null> {
  try {
    const raw = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(await workspaceDir(bot), "plan.json"), "utf8")) as Record<string, unknown>;
    const steps = Array.isArray(raw.steps)
      ? raw.steps
          .slice(0, 20)
          .map((s) => {
            const r = (s ?? {}) as Record<string, unknown>;
            return {
              text: line(r.text, 200),
              done: r.done === true,
              doneAt: typeof r.done_at === "string" ? r.done_at : null,
              estimateMin: minutes(r.estimate_min),
              spentMin: null as number | null,
              engineActual: typeof r.actual_min === "number" ? Math.round(r.actual_min) : null,
              activeMin: minutes(r.active_min),
              actionsEngine: typeof r.actions === "number" ? Math.round(r.actions) : null,
            };
          })
          .filter((s) => s.text)
      : [];
    const status = line(raw.status, 20) || "active";
    const started = typeof raw.started === "string" ? raw.started : null;
    const updated = typeof raw.updated === "string" ? raw.updated : null;
    const end = status === "active" ? localIso(Date.now()) : (updated ?? localIso(Date.now()));
    const stamps = started ? await actionTimes(bot, started, end) : [];
    // Each ticked step owns the working time from the previous tick (or the start) to its own tick; the first open
    // step owns the time since the last tick, while the plan is active.
    let from = started ?? "";
    let openSeen = false;
    for (const st of steps) {
      if (st.done && st.doneAt) {
        st.spentMin = st.engineActual ?? workMinutes(stamps, from, st.doneAt);
        from = st.doneAt;
      } else if (!st.done && !openSeen && status === "active") {
        st.spentMin = workMinutes(stamps, from, end);
        openSeen = true;
      }
    }
    return {
      task: line(raw.task, 240),
      source: line(raw.source, 20),
      doneWhen: line(raw.done_when, 240),
      steps,
      status,
      started,
      updated,
      estimateMin: minutes(raw.estimate_min),
      spentMin: started ? workMinutes(stamps, started, end) : 0,
      actions: stamps.length,
      note: line(raw.note, 300),
      workedSince: status !== "active" && updated ? await acceptedSince(bot, updated) : 0,
      activeMin: minutes(raw.active_min),
      actionsEngine: typeof raw.actions === "number" ? Math.round(raw.actions) : null,
      firstStepMin: minutes(raw.first_step_min),
      measured: typeof raw.active_min === "number",
    };
  } catch {
    return null;
  }
}

/** Open Validator findings per bot slug, split by severity. */
async function openFlags(): Promise<Record<string, Flags>> {
  const out: Record<string, Flags> = {};
  try {
    const raw = JSON.parse(await readFile(/*turbopackIgnore: true*/ FLAGS_FILE, "utf8")) as Record<string, { bot?: string; status?: string; severity?: string }>;
    for (const f of Object.values(raw)) {
      if (!f || f.status !== "open" || !f.bot) continue;
      const row = (out[f.bot] ??= { errors: 0, warns: 0 });
      if (f.severity === "error") row.errors++;
      else row.warns++;
    }
  } catch {
    /* no Validator run yet */
  }
  return out;
}

async function selfGoalOf(bot: BotProfile): Promise<string> {
  try {
    return line(await readFile(/*turbopackIgnore: true*/ path.join(await workspaceDir(bot), "self_goal.md"), "utf8"), 400);
  } catch {
    return "";
  }
}

/** Tokens each bot spent today, from the fleet's model-call ledger (keyed by bot name, reset daily). */
async function tokensToday(): Promise<Record<string, number>> {
  try {
    const raw = JSON.parse(await readFile(/*turbopackIgnore: true*/ CALLS_FILE, "utf8")) as { day?: string; by_bot?: Record<string, number> };
    return raw.day === localIso(Date.now()).slice(0, 10) && raw.by_bot ? raw.by_bot : {};
  } catch {
    return {};
  }
}

async function scoreOf(bot: BotProfile, tokens: number | undefined): Promise<Score> {
  const since = `${localIso(Date.now()).slice(0, 10)}T00:00:00`;
  let outputs = 0;
  let refused = 0;
  let allowed = 0;
  try {
    const rows = await query(
      await dbPath(bot),
      `SELECT action_type AS t, verdict = 'allowed' AS ok, COUNT(*) AS n FROM actions WHERE ts >= ${sq(since)} GROUP BY 1, 2`,
    );
    for (const r of rows) {
      const n = Number(r.n) || 0;
      if (Number(r.ok) === 1) {
        allowed += n;
        if (OUTPUT_TYPES.includes(String(r.t))) outputs += n;
      } else refused += n;
    }
  } catch {
    /* no database yet */
  }
  const t = typeof tokens === "number" ? tokens : null;
  return { outputs, refused, allowed, tokens: t, perMillion: t && t > 0 ? Math.round((outputs / t) * 1_000_000 * 10) / 10 : null };
}

export async function workCards(bots: BotProfile[]): Promise<{ cards: WorkCard[]; updatedAt: string | null }> {
  const [doc, tokens, flags, target] = await Promise.all([readOwnerPlans(), tokensToday(), openFlags(), readTarget()]);
  const cards = await Promise.all(
    bots.map(async (bot) => ({
      slug: bot.slug,
      name: bot.name,
      handle: bot.handle,
      plan: await readBotPlan(bot),
      owner: doc.bots[bot.slug] ?? { goal: "", rules: [] },
      // The goal its persona already states (the first sentence of its "## ...goal" section), shown as a hint.
      personaGoal: await readPersona(bot)
        .then((d) => line(fillTarget(d.goals.split(/(?<=[.!?])\s/)[0] ?? "", target), MAX_GOAL))
        .catch(() => ""),
      selfGoal: await selfGoalOf(bot),
      flags: flags[bot.slug] ?? { errors: 0, warns: 0 },
      capabilities: await capabilitiesOf(bot).catch(() => ({ state: "Unknown", can: [], cannot: [] })),
      score: await scoreOf(bot, tokens[bot.name]),
      stopped: await workspaceDir(bot).then((ws) => stat(/*turbopackIgnore: true*/ path.join(ws, "STOP")).then(() => true, () => false)),
    })),
  );
  return { cards, updatedAt: doc.updatedAt };
}

export type Attention = { ticks: number; finished: string[]; stuck: string[]; needed: boolean };

/** What moved on the agents' checklists since `since` (the owner's last look at the page): the header's red dot. It
 * lights for any job finished or stuck, or for 3+ steps ticked. Plans only, so it stays cheap to poll. */
export async function attentionSince(bots: BotProfile[], since: string): Promise<Attention> {
  const out: Attention = { ticks: 0, finished: [], stuck: [], needed: false };
  for (const bot of bots) {
    const plan = await readBotPlan(bot);
    if (!plan) continue;
    out.ticks += plan.steps.filter((s) => s.doneAt && s.doneAt > since).length;
    if (plan.updated && plan.updated > since) {
      if (plan.status === "done") out.finished.push(bot.name);
      if (plan.status === "stuck") out.stuck.push(bot.name);
    }
  }
  out.needed = out.finished.length + out.stuck.length > 0 || out.ticks >= 3;
  return out;
}

export type PastStep = { text: string; done: boolean; activeMin: number | null; actions: number | null };
/** A finished plan as the engine archived it. The active-time fields come from macBot1 a2b80a5 (2026-10-15); older
 *  lines have none of them, and the page shows "—" for those rather than a guess. */
export type PastJob = {
  slug: string;
  name: string;
  task: string;
  status: string;
  started: string | null;
  ended: string | null;
  note: string;
  steps: PastStep[];
  activeMin: number | null; // minutes of steady work on it (gaps capped at twice the bot's cycle), not hours open
  actions: number | null;
  openMin: number | null; // wall clock, for reference only
  firstStepMin: number | null; // active minutes to the first ticked step
  closedBy: "bot" | "engine" | null;
  closedReason: string;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null);

/** Finished jobs from every agent's workspace/plan-history.jsonl (the engine appends one line when a plan ends; the
 * file is append-only and survives fresh starts), newest first. */
export async function pastJobs(bots: BotProfile[], limit = 200): Promise<PastJob[]> {
  const all: PastJob[] = [];
  for (const bot of bots) {
    let text = "";
    try {
      text = await readFile(/*turbopackIgnore: true*/ path.join(await workspaceDir(bot), "plan-history.jsonl"), "utf8");
    } catch {
      continue;
    }
    for (const raw of text.split("\n")) {
      if (!raw.trim()) continue;
      let r: Record<string, unknown>;
      try {
        r = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue; // a torn last line
      }
      const steps = Array.isArray(r.steps)
        ? r.steps.slice(0, 20).map((x) => {
            const st = (x ?? {}) as Record<string, unknown>;
            return { text: line(st.text, 200), done: st.done === true, activeMin: num(st.active_min), actions: num(st.actions) };
          })
        : [];
      all.push({
        slug: bot.slug,
        name: bot.name,
        task: line(r.task, 240),
        status: line(r.status, 20),
        started: typeof r.started === "string" ? r.started : null,
        ended: typeof r.ended === "string" ? r.ended : null,
        note: line(r.note, 300),
        steps,
        activeMin: num(r.active_min),
        actions: num(r.actions),
        openMin: num(r.open_min),
        firstStepMin: num(r.first_step_min),
        closedBy: r.closed_by === "engine" ? "engine" : r.closed_by === "bot" ? "bot" : null,
        closedReason: line(r.closed_reason, 160),
      });
    }
  }
  return all.sort((a, b) => ((a.ended ?? "") < (b.ended ?? "") ? 1 : -1)).slice(0, limit);
}

// The rate is refused / (allowed + refused). Counted apart and never against the 20 % target:
// the fence (the safety rules working: a personal mailbox, an email not on the business's own site, an invented value,
// a site that asks bots not to read it), "held" (waiting for someone), "failed" (ran and did not work, e.g. a row already
// drafted) and "closed" (a site closed for the day). lib/checks.ts kindOf decides.
export type RefusalDay = { day: string; allowed: number; refused: number; fence: number; held: number; failed: number; closed: number };
export type RefusalReason = { reason: string; kind: Kind; n: number; cases: Case[] };
export type RefusalStats = {
  slug: string;
  name: string;
  days: RefusalDay[];
  today: RefusalDay;
  week: RefusalDay;
  /** The seven days before (B1: the ↑/↓ against last week). */
  prevWeek: RefusalDay;
  reasons: RefusalReason[];
  /** The newest action in the bot's table (its source's freshness); null with `error` when the table cannot be read. */
  lastAt: string | null;
  error: string | null;
};

const emptyDay = (day: string): RefusalDay => ({ day, allowed: 0, refused: 0, fence: 0, held: 0, failed: 0, closed: 0 });
const addDay = (a: RefusalDay, d: RefusalDay): RefusalDay => ({ day: a.day, allowed: a.allowed + d.allowed, refused: a.refused + d.refused, fence: a.fence + d.fence, held: a.held + d.held, failed: a.failed + d.failed, closed: a.closed + d.closed });

/** Per bot, the last seven days by kind, the top reasons this week (not fence or allowed) in plain words with their three
 *  newest cases, and how fresh its table is. Read-only from each bot's actions table. */
export async function refusalStats(bots: BotProfile[]): Promise<RefusalStats[]> {
  const today = localIso(Date.now()).slice(0, 10);
  const from = localIso(Date.now() - 6 * 86400e3).slice(0, 10);
  const from14 = localIso(Date.now() - 13 * 86400e3).slice(0, 10);
  const monthAgo = localIso(Date.now() - 30 * 86400e3);
  const out: RefusalStats[] = [];
  for (const bot of bots) {
    let rows: Row[] = [];
    let cases: Row[] = [];
    let lastAt: string | null = null;
    let error: string | null = null;
    try {
      const db = await dbPath(bot);
      // One row per day and distinct verdict text (allowed rows collapse to one per day), classified here.
      [rows, cases] = await Promise.all([
        query(db, `SELECT substr(ts,1,10) AS day, CASE WHEN verdict = 'allowed' THEN '' ELSE substr(verdict,1,200) END AS v, COUNT(*) AS n FROM actions WHERE ts >= ${sq(from14)} GROUP BY 1, 2`),
        query(
          db,
          `SELECT ts, verdict AS v, action_type AS t, coalesce(json_extract(payload,'$.name'), json_extract(payload,'$.business'), json_extract(payload,'$.lead'), '') AS b, coalesce(json_extract(payload,'$.query'), json_extract(payload,'$.url'), json_extract(payload,'$.field'), json_extract(payload,'$.title'), '') AS w FROM actions WHERE ts >= ${sq(from)} AND verdict != 'allowed' ORDER BY ts DESC LIMIT 600`,
        ).catch(() => [] as Row[]),
      ]);
      const [last] = await query(db, "SELECT max(ts) AS at FROM actions");
      lastAt = last?.at ? String(last.at) : null;
    } catch (err) {
      error = err instanceof Error ? err.message.split("\n")[0].slice(0, 160) : String(err);
    }
    if (!error && (!lastAt || lastAt < monthAgo)) continue; // a retired bot: nothing in a month
    const byDay = new Map<string, RefusalDay>();
    const merged = new Map<string, { kind: Kind; n: number }>();
    for (const r of rows) {
      const day = String(r.day);
      const d = byDay.get(day) ?? emptyDay(day);
      const v = String(r.v ?? "");
      const n = Number(r.n);
      const kind = kindOf(v);
      d[kind] += n;
      if (kind !== "allowed" && kind !== "fence" && day >= from) {
        const key = reasonLabel(v);
        const m = merged.get(key) ?? { kind, n: 0 };
        m.n += n;
        merged.set(key, m);
      }
      byDay.set(day, d);
    }
    const days: RefusalDay[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = localIso(Date.now() - i * 86400e3).slice(0, 10);
      days.push(byDay.get(d) ?? emptyDay(d));
    }
    const week = days.reduce(addDay, emptyDay("7d"));
    const prevWeek = [...byDay.values()].filter((d) => d.day < from).reduce(addDay, emptyDay("prev"));
    const top = [...merged.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 5);
    const reasons: RefusalReason[] = top.map(([reason, m]) => ({
      reason,
      kind: m.kind,
      n: m.n,
      cases: cases
        .filter((c) => reasonLabel(String(c.v ?? "")) === reason)
        .slice(0, 3)
        .map((c) => ({ ts: String(c.ts), business: String(c.b ?? "").slice(0, 80), tried: `${String(c.t ?? "")}${c.w ? `: ${String(c.w).slice(0, 120)}` : ""}` })),
    }));
    out.push({ slug: bot.slug, name: bot.name, days, today: days.find((d) => d.day === today) ?? emptyDay(today), week, prevWeek, reasons, lastAt, error });
  }
  return out;
}
