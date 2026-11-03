// "This week", per person, and the weekly statement. Attribution: a lead belongs to the
// person in its "Sent by" cell on the board (the Validator fills it from Notion's last-edited-by when Status turns Email
// Sent); a click on "I sent it" here counts too. A lead's later Result counts for that same person. Tasks done come from
// the task board: Status "Done" with the person in "Assign", edited this week. Pure functions, tested apart from Notion.
import { and, eq, gte } from "drizzle-orm";
import type { Db } from "./db";
import { outcomes, shifts, users } from "./db/schema";
import { roundShift } from "./cadence";
import { peopleOf, STATUS_SENT, text, type NotionPage } from "./queue";

export type Person = { id: string; name: string; email: string; role: string; notionUserId: string | null };
export type PersonWeek = { userId: string; name: string; role: string; sent: number; replies: number; meetings: number; clients: number; tasksDone: number; minutes: number };

const REACHED: Record<string, number> = { Replied: 1, "Not interested": 1, Meeting: 2, Client: 3 };

/** The ramen-agents user behind a Notion person: by Notion user id first, else by email. */
export function personFor(people: Person[], notion: { id: string; email: string }): Person | undefined {
  return people.find((p) => p.notionUserId && p.notionUserId === notion.id) ?? (notion.email ? people.find((p) => p.email === notion.email) : undefined);
}

export function scoreboard(
  people: Person[],
  clicks: { userId: string | null; pageId: string; at: Date }[],
  leads: NotionPage[],
  tasks: NotionPage[],
  shiftRows: { userId: string; startedAt: Date; endedAt: Date | null }[],
  from: Date,
  now = new Date(),
  step = 0, // settings.updates.rounding: each shift rounded (start down, end up) for the totals; raw times stay stored
): PersonWeek[] {
  // Who sent each lead: the board's "Sent by", else the person who clicked "I sent it" here.
  const sender = new Map<string, string>();
  const sentAt = new Map<string, Date>();
  for (const c of clicks) {
    if (c.userId && !sender.has(c.pageId)) {
      sender.set(c.pageId, c.userId);
      sentAt.set(c.pageId, c.at);
    }
  }
  for (const page of leads) {
    const by = peopleOf(page.properties["Sent by"]).map((n) => personFor(people, n)).find(Boolean);
    if (by) sender.set(page.id, by.id);
    if (text(page.properties.Status) === STATUS_SENT && page.last_edited_time && !sentAt.has(page.id)) sentAt.set(page.id, new Date(page.last_edited_time));
  }
  const rows = new Map(people.map((p) => [p.id, { userId: p.id, name: p.name || p.email, role: p.role, sent: 0, replies: 0, meetings: 0, clients: 0, tasksDone: 0, minutes: 0 }]));
  for (const page of leads) {
    const who = sender.get(page.id);
    const row = who ? rows.get(who) : undefined;
    if (!row) continue;
    const when = sentAt.get(page.id);
    if (text(page.properties.Status) === STATUS_SENT && when && when >= from) row.sent++;
    const result = text(page.properties.Result);
    const resultAt = new Date(text(page.properties["Result date"]) || page.last_edited_time || 0);
    const level = REACHED[result] ?? 0;
    if (level && resultAt >= from) {
      row.replies++;
      if (level >= 2) row.meetings++;
      if (level >= 3) row.clients++;
    }
  }
  for (const task of tasks) {
    if (text(task.properties.Status) !== "Done" || new Date(task.last_edited_time ?? 0) < from) continue;
    for (const n of peopleOf(task.properties.Assign)) {
      const p = personFor(people, n);
      if (p) rows.get(p.id)!.tasksDone++;
    }
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
