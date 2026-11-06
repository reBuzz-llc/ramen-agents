// "This week", per person, and the weekly statement. Attribution: a lead belongs to the
// person in its "Sent by" cell on the board (the store fills it with the person who marks it Email Sent); a click on
// "I sent it" counts too. A lead's later Result counts for that same person. Tasks done: Status "Done" with the person
// among the assignees, last changed this week. Read from the portal's own board: lib/lead-queue.ts scoreFacts. Pure functions, tested apart from the database.
import { and, eq, gte } from "drizzle-orm";
import type { Db } from "./db";
import { outcomes, shifts, users } from "./db/schema";
import { roundShift } from "./cadence";

export type Person = { id: string; name: string; email: string; role: string; notionUserId: string | null };
export type PersonWeek = { userId: string; name: string; role: string; sent: number; replies: number; meetings: number; clients: number; tasksDone: number; minutes: number };
/** A lead as the scoreboard needs it. `notionPageId`: clicks made while the queue still read Notion carry that id. */
export type LeadFact = { id: string; notionPageId: string | null; emailStatus: string | null; sentBy: string[]; sentAt: Date | null; result: string | null; resultDate: string | null; updatedAt: Date };
export type TaskFact = { status: string; assignees: string[]; updatedAt: Date };

const REACHED: Record<string, number> = { Replied: 1, "Not interested": 1, Meeting: 2, Client: 3 };
const SENT = "Email Sent";

/** The ramen-agents user behind a name in a Sent by or assignee cell: by name, else by email (no case). */
export function personNamed(people: Person[], who: string): Person | undefined {
  const k = who.trim().toLowerCase();
  if (!k) return undefined;
  return people.find((p) => p.name.trim().toLowerCase() === k) ?? people.find((p) => p.email.toLowerCase() === k);
}

export function scoreboard(
  people: Person[],
  clicks: { userId: string | null; pageId: string; at: Date }[],
  leads: LeadFact[],
  tasks: TaskFact[],
  shiftRows: { userId: string; startedAt: Date; endedAt: Date | null }[],
  from: Date,
  now = new Date(),
  step = 0, // settings.updates.rounding: each shift rounded (start down, end up) for the totals; raw times stay stored
): PersonWeek[] {
  // A click by lead id, or by the Notion page id it had before the queue moved over.
  const click = new Map<string, { userId: string; at: Date }>();
  for (const c of clicks) if (c.userId && !click.has(c.pageId)) click.set(c.pageId, { userId: c.userId, at: c.at });
  const rows = new Map(people.map((p) => [p.id, { userId: p.id, name: p.name || p.email, role: p.role, sent: 0, replies: 0, meetings: 0, clients: 0, tasksDone: 0, minutes: 0 }]));
  for (const l of leads) {
    const c = click.get(l.id) ?? (l.notionPageId ? click.get(l.notionPageId) : undefined);
    const who = l.sentBy.map((n) => personNamed(people, n)).find(Boolean)?.id ?? c?.userId;
    const row = who ? rows.get(who) : undefined;
    if (!row) continue;
    // When it was sent: the board's Sent at, else the click, else (an imported row) its result date.
    const when = l.sentAt ?? c?.at ?? (l.resultDate ? new Date(`${l.resultDate}T00:00:00`) : null);
    if (l.emailStatus === SENT && when && when >= from) row.sent++;
    const level = REACHED[l.result ?? ""] ?? 0;
    const resultAt = l.resultDate ? new Date(`${l.resultDate}T00:00:00`) : l.updatedAt;
    if (level && resultAt >= from) {
      row.replies++;
      if (level >= 2) row.meetings++;
      if (level >= 3) row.clients++;
    }
  }
  for (const t of tasks) {
    if (t.status !== "Done" || t.updatedAt < from) continue;
    const done = new Set(t.assignees.map((a) => personNamed(people, a)?.id).filter(Boolean) as string[]);
    for (const id of done) rows.get(id)!.tasksDone++;
  }
  for (const s of shiftRows) {
    const row = rows.get(s.userId);
    if (!row || s.startedAt < from) continue;
    const r = roundShift(s.startedAt, s.endedAt ?? now, step);
    row.minutes += Math.max(0, Math.round((r.endedAt.getTime() - r.startedAt.getTime()) / 60000));
  }
  return [...rows.values()];
}

export async function weekRows(db: Db, tenantId: string, from: Date) {
  // Three independent reads at once: one round trip of waiting.
  const [people, clicks, shiftRows] = await Promise.all([
    db
      .select({ id: users.id, name: users.name, email: users.email, role: users.role, notionUserId: users.notionUserId })
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
