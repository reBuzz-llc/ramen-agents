// "This week", per person, and the weekly statement. Sends are emails and WhatsApp messages, counted apart. Attribution: a lead belongs to the
// person in its "Sent by" cell on the board (the store fills it with the person who marks it Email Sent); a click on
// "I sent it" counts too. A lead's later Result counts for that same person. Read from Peek's own board (Notion is frozen
// history): lib/lead-queue.ts scoreFacts. Pure functions, tested apart from the database.
import { and, eq, gte } from "drizzle-orm";
import type { Db } from "./db";
import { outcomes, shifts, users } from "./db/schema";
import { roundShift } from "./cadence";
import { displayName } from "./display-name";
import { addDay, dayStartOf } from "./periods";

export type Person = { id: string; name: string; email: string; role: string };
export type PersonWeek = { userId: string; name: string; role: string; sent: number; whatsapp?: number; replies: number; meetings: number; clients: number; minutes: number };
/** A lead as the scoreboard needs it (clicks made while the queue still read Notion carried its page id, dropped in Peek:
 *  such a click counts only through Sent by). */
export type LeadFact = {
  id: string;
  emailStatus: string | null;
  sentBy: string[];
  sentAt: Date | null;
  result: string | null;
  resultDate: string | null;
  /** When the step that wrote this Result date was made, from the lead's History. */
  resultSetAt?: Date | null;
  /** Every step that wrote Result, from the lead's History, so a period counts what was reached in it. */
  resultSteps?: { value: string | null; at: Date }[];
  updatedAt: Date;
  /** WhatsApp: the status, and who pressed "WhatsApp message sent" and when (the lead's History). */
  whatsappStatus?: string | null;
  waSentAt?: Date | null;
  waSentBy?: string | null;
};

// Any answer counts as a reply and earns the reply bonus, including "Not interested".
const REACHED: Record<string, number> = { Replied: 1, "Not interested": 1, Meeting: 2, Client: 3 };
const SENT = "Email Sent";
const WA_SENT = "WhatsApp msg sent";

/** The Productive Peek user behind a name in a Sent by or assignee cell: by name, else by email (no case). */
export function personNamed(people: Person[], who: string): Person | undefined {
  const k = who.trim().toLowerCase();
  if (!k) return undefined;
  return people.find((p) => p.name.trim().toLowerCase() === k) ?? people.find((p) => p.email.toLowerCase() === k);
}

/** Is this lead's result inside a window that starts at `from`? A Result date has no time, and the buttons store the
 *  UTC day, so reading it as local midnight lost a result pressed early in the Mac's day. A date stored as the UTC day of the step
 *  that wrote it is that step's exact moment. Any other date (typed, moved, imported) is a calendar day: in if any of it is.
 *  `until` (not included) ends the window, and a calendar day belongs to the window it starts in, so one week only. */
export function resultInWindow(l: Pick<LeadFact, "resultDate" | "resultSetAt" | "updatedAt">, from: Date, until?: Date, tz?: string | null): boolean {
  const beforeEnd = (d: Date) => !until || d < until;
  if (!l.resultDate) return l.updatedAt >= from && beforeEnd(l.updatedAt);
  if (l.resultSetAt && l.resultSetAt.toISOString().slice(0, 10) === l.resultDate) return l.resultSetAt >= from && beforeEnd(l.resultSetAt);
  // the day as the company reads it
  return dayStartOf(addDay(l.resultDate, 1), tz) > from && beforeEnd(dayStartOf(l.resultDate, tz));
}

/** What this lead reached inside the window, each level counted in the period it was first reached (a Reply in week 1 that
 *  becomes a Meeting in week 3 is a reply in week 1 and a meeting in week 3, never both in one). Read from the lead's History. A step
 *  back to no answer (an undone press, a bounce) clears what came before. A row with no History for its Result (an import) keeps the
 *  older reading: everything it holds, on its Result date. */
export function resultsIn(l: Pick<LeadFact, "result" | "resultDate" | "resultSetAt" | "updatedAt" | "resultSteps">, from: Date, until?: Date, tz?: string | null): { replies: number; meetings: number; clients: number } {
  const level = REACHED[l.result ?? ""] ?? 0;
  if (!level) return { replies: 0, meetings: 0, clients: 0 };
  const steps = [...(l.resultSteps ?? [])];
  const last = steps[steps.length - 1];
  const dated = () => resultInWindow(l, from, until, tz);
  if (!last || last.value !== l.result) {
    const hit = dated() ? 1 : 0;
    return { replies: hit, meetings: level >= 2 ? hit : 0, clients: level >= 3 ? hit : 0 };
  }
  const first: (Date | null)[] = [null, null, null, null];
  for (const s of steps) {
    const v = REACHED[s.value ?? ""] ?? 0;
    if (!v) first.fill(null);
    else for (let k = 1; k <= v; k++) first[k] ??= s.at;
  }
  // the newest step may carry a Result date someone typed: that date is when it happened
  const hit = (k: number) => {
    const at = first[k];
    if (!at) return 0;
    if (l.resultDate && at.getTime() === last.at.getTime()) return dated() ? 1 : 0;
    return at >= from && (!until || at < until) ? 1 : 0;
  };
  return { replies: hit(1), meetings: hit(2), clients: hit(3) };
}

export function scoreboard(
  people: Person[],
  clicks: { userId: string | null; pageId: string; at: Date }[],
  leads: LeadFact[],
  shiftRows: { userId: string; startedAt: Date; endedAt: Date | null }[],
  from: Date,
  now = new Date(),
  step = 0, // settings.updates.rounding: each shift rounded (start down, end up) for the totals; raw times stay stored
  until?: Date, // a statement's week end (not included); This week and the Leaderboard run to now
  tz?: string | null, // the company's zone, for a Result date that is a calendar day
): PersonWeek[] {
  const inside = (d: Date) => d >= from && (!until || d < until);
  // A click by lead id.
  const click = new Map<string, { userId: string; at: Date }>();
  for (const c of clicks) if (c.userId && !click.has(c.pageId)) click.set(c.pageId, { userId: c.userId, at: c.at });
  const rows = new Map(people.map((p) => [p.id, { userId: p.id, name: displayName(p.name, p.email), role: p.role, sent: 0, whatsapp: 0, replies: 0, meetings: 0, clients: 0, minutes: 0 }]));
  for (const l of leads) {
    const c = click.get(l.id);
    const who = l.sentBy.map((n) => personNamed(people, n)).find(Boolean)?.id ?? c?.userId;
    // A WhatsApp message sent counts for the person who pressed it, when they pressed it (else Sent by and Sent at).
    if (l.whatsappStatus === WA_SENT) {
      const waRow = rows.get(l.waSentBy ?? "") ?? (who ? rows.get(who) : undefined);
      const waWhen = l.waSentAt ?? l.sentAt;
      if (waRow && waWhen && inside(waWhen)) waRow.whatsapp = (waRow.whatsapp ?? 0) + 1;
    }
    const row = who ? rows.get(who) : undefined;
    if (!row) continue;
    // When it was sent: the board's Sent at, else the click, else (an imported row) its result date.
    const when = l.sentAt ?? c?.at;
    if (l.emailStatus === SENT && (when ? inside(when) : !!l.resultDate && resultInWindow(l, from, until, tz))) row.sent++;
    const got = resultsIn(l, from, until, tz);
    row.replies += got.replies;
    row.meetings += got.meetings;
    row.clients += got.clients;
  }
  for (const s of shiftRows) {
    const row = rows.get(s.userId);
    if (!row || !inside(s.startedAt)) continue;
    const r = roundShift(s.startedAt, s.endedAt ?? now, step);
    row.minutes += Math.max(0, Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 60000));
  }
  return [...rows.values()];
}

export async function weekRows(db: Db, tenantId: string, from: Date) {
  // Three independent reads at once: one round trip of waiting.
  const [people, clicks, shiftRows] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role })
      .from(users)
      .where(and(eq(users.tenantId, tenantId), eq(users.active, true))) as Promise<Person[]>,
    db.select({ userId: outcomes.userId, pageId: outcomes.pageId, at: outcomes.at }).from(outcomes).where(and(eq(outcomes.tenantId, tenantId), eq(outcomes.kind, "sent"))),
    db.select({ userId: shifts.userId, startedAt: shifts.startedAt, endedAt: shifts.endedAt, projectId: shifts.projectId }).from(shifts).where(and(eq(shifts.tenantId, tenantId), gte(shifts.startedAt, from))),
  ]);
  return { people, clicks, shiftRows };
}

// ---- the weekly statement ---------------------------------------------------------------------------------------

export type Rates = { hourly?: number; outcomeBonus?: number; currency?: string };
/** One project in one rate period of the week (lib/rates.ts): hours x the hourly rate in force when they were worked. */
export type StatementLine = { project: string; from: string; to: string; hours: number; hourly: number | null; base: number | null };
export type Statement = {
  hours: number;
  hourly: number | null;
  base: number | null;
  outcomes: number;
  outcomeBonus: number | null;
  bonus: number | null;
  total: number | null;
  currency: string;
  /** Why a figure is missing: the owner has not set that rate. Nothing is computed from a guess. */
  missing: string[];
  /** Hours by project and rate period (per-person rates); absent on statements approved before them. */
  lines?: StatementLine[];
};

/** Hours x hourly rate + outcome bonus x (replies + meetings + clients). Rates the owner has not set stay null. */
export function statementOf(week: PersonWeek, rates: Rates = {}): Statement {
  const hours = Math.round((week.minutes / 60) * 100) / 100;
  const outcomeCount = week.replies + week.meetings + week.clients;
  const hourly = typeof rates.hourly === "number" ? rates.hourly : null;
  const outcomeBonus = typeof rates.outcomeBonus === "number" ? rates.outcomeBonus : null;
  const base = hourly === null ? null : Math.round(hours * hourly * 100) / 100;
  const bonus = outcomeBonus === null ? null : Math.round(outcomeCount * outcomeBonus * 100) / 100;
  const missing = [...(hourly === null ? ["hourly rate"] : []), ...(outcomeBonus === null ? ["outcome bonus"] : [])];
  return {
    hours,
    hourly,
    base,
    outcomes: outcomeCount,
    outcomeBonus,
    bonus,
    total: base === null || bonus === null ? null : Math.round((base + bonus) * 100) / 100,
    currency: rates.currency || "USD",
    missing,
  };
}
