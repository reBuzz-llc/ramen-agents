// A person's week as a statement: live while it is a draft, frozen once a manager or the owner approves it.
import { and, eq, gte, lt } from "drizzle-orm";
import type { Db } from "./db";
import { shifts, statements, users } from "./db/schema";
import { rateHistory } from "./member-rates";
import { projectsOf } from "./projects";
import { addDays, daysOf, memberStatement, statementLines, type DayLine, type ShiftLike } from "./rates";
import { longOpenInWeek, longOpenLine, StatementBlocked } from "./open-clock";
import { dayStartOf } from "./periods";
import { notesSince } from "./shift-notes";
import { minutesByProject } from "./timesheet";
import { scoreFacts } from "./lead-queue";
import { scoreboard, weekRows, type LeadFact, type PersonWeek, type Statement } from "./scoreboard";
import { settingsOf } from "./tenants";

export type WeekStatement = { week: PersonWeek; statement: Statement; weekStart: string; approved: { by: string; at: string } | null; days: DayLine[] };

export async function statementFor(db: Db, tenantId: string, userId: string, weekStart: string): Promise<WeekStatement | null> {
  // what does not depend on another read is read together, so a statement takes two trips to the database and not eight
  const [[frozen], settings] = await Promise.all([
    db.select().from(statements).where(and(eq(statements.tenantId, tenantId), eq(statements.userId, userId), eq(statements.weekStart, weekStart))),
    settingsOf(db, tenantId),
  ]);
  if (frozen) {
    const [by] = frozen.approvedBy ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, frozen.approvedBy)) : [];
    const data = frozen.data as { week: PersonWeek; statement: Statement; days?: DayLine[] };
    return { ...data, days: data.days ?? [], weekStart, approved: { by: by?.name || by?.email || "", at: frozen.approvedAt.toISOString() } };
  }
  // The week as the company reads it, and the next week's own start, so a clock change cannot leave an hour in two
  // weeks or in neither.
  const tz = settings.timezone;
  const from = dayStartOf(weekStart, tz);
  const to = dayStartOf(addDays(weekStart, 7), tz);
  const noBoard: { leads: LeadFact[] } = { leads: [] }; // no board yet: hours only
  const [{ people, clicks, shiftRows }, { leads }, history, worked, projects, notes] = await Promise.all([
    weekRows(db, tenantId, from),
    scoreFacts(db, tenantId, from, tz).catch(() => noBoard),
    rateHistory(db, tenantId, userId), // the person's own rates (a mid-week change splits the hours), else the company's defaults
    db.select({ id: shifts.id, startedAt: shifts.startedAt, endedAt: shifts.endedAt, projectId: shifts.projectId }).from(shifts)
      .where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), gte(shifts.startedAt, from), lt(shifts.startedAt, to))) as Promise<(ShiftLike & { id: string })[]>,
    projectsOf(db, tenantId),
    notesSince(db, tenantId, userId, from), // only notes on this week's shifts are kept
  ]);
  const inWeek = <T extends { startedAt: Date }>(xs: T[]) => xs.filter((s) => s.startedAt < to);
  const step = settings.updates?.rounding ?? 0;
  const week = scoreboard(people, clicks, leads, inWeek(shiftRows), from, to < new Date() ? to : new Date(), step, to, tz).find((r) => r.userId === userId);
  if (!week) return null;
  const defaults = settings.rates ?? {};
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const lines = statementLines(worked, history, defaults, weekStart, to < new Date() ? to : new Date(), minutesByProject, names, step, tz);
  const ids = new Set(worked.map((w) => w.id));
  const days = daysOf(worked, notes.filter((n) => ids.has(n.shiftId)), to < new Date() ? to : new Date(), projects, settings, step);
  return { week, statement: memberStatement(week, lines, history, defaults, weekStart), weekStart, approved: null, days };
}

/** Freeze the statement as it stands. Approving twice keeps the first approval. */
export async function approve(db: Db, tenantId: string, userId: string, weekStart: string, approverId: string) {
  const s = await statementFor(db, tenantId, userId, weekStart);
  if (!s || s.approved) return s;
  // never freeze hours from a clock that was left running
  const { timezone } = await settingsOf(db, tenantId);
  const open = await longOpenInWeek(db, tenantId, userId, dayStartOf(weekStart, timezone), dayStartOf(addDays(weekStart, 7), timezone));
  if (open) throw new StatementBlocked(longOpenLine(open.hours));
  await db.insert(statements).values({ tenantId, userId, weekStart, data: { week: s.week, statement: s.statement, days: s.days }, approvedBy: approverId }).onConflictDoNothing();
  return statementFor(db, tenantId, userId, weekStart);
}
