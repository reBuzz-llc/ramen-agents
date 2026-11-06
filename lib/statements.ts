// A person's week as a statement: live while it is a draft, frozen once a manager or the owner approves it.
import { and, eq, gte, lt } from "drizzle-orm";
import type { Db } from "./db";
import { shifts, statements, users } from "./db/schema";
import { rateHistory } from "./member-rates";
import { projectsOf } from "./projects";
import { daysOf, memberStatement, statementLines, type DayLine, type ShiftLike } from "./rates";
import { notesSince } from "./shift-notes";
import { minutesByProject } from "./timesheet";
import { scoreFacts } from "./lead-queue";
import { scoreboard, weekRows, type LeadFact, type PersonWeek, type Statement, type TaskFact } from "./scoreboard";
import { settingsOf } from "./tenants";

export type WeekStatement = { week: PersonWeek; statement: Statement; weekStart: string; approved: { by: string; at: string } | null; days: DayLine[] };

export async function statementFor(db: Db, tenantId: string, userId: string, weekStart: string): Promise<WeekStatement | null> {
  const [frozen] = await db.select().from(statements).where(and(eq(statements.tenantId, tenantId), eq(statements.userId, userId), eq(statements.weekStart, weekStart)));
  if (frozen) {
    const [by] = frozen.approvedBy ? await db.select({ name: users.name, email: users.email }).from(users).where(eq(users.id, frozen.approvedBy)) : [];
    const data = frozen.data as { week: PersonWeek; statement: Statement; days?: DayLine[] };
    return { ...data, days: data.days ?? [], weekStart, approved: { by: by?.name || by?.email || "", at: frozen.approvedAt.toISOString() } };
  }
  const from = new Date(`${weekStart}T00:00:00`);
  const to = new Date(from.getTime() + 7 * 86400e3);
  const { people, clicks, shiftRows } = await weekRows(db, tenantId, from);
  let leads: LeadFact[] = [];
  let tasks: TaskFact[] = [];
  try {
    ({ leads, tasks } = await scoreFacts(db, tenantId, from));
  } catch {
    /* no board yet: hours only */
  }
  const inWeek = <T extends { startedAt: Date }>(xs: T[]) => xs.filter((s) => s.startedAt < to);
  const settings = await settingsOf(db, tenantId);
  const step = settings.updates?.rounding ?? 0;
  const week = scoreboard(people, clicks, leads, tasks, inWeek(shiftRows), from, to < new Date() ? to : new Date(), step).find((r) => r.userId === userId);
  if (!week) return null;
  // The person's own rates (history, so a mid-week change splits the hours), else the company's defaults.
  const defaults = settings.rates ?? {};
  const history = await rateHistory(db, tenantId, userId);
  const [worked, projects, notes] = await Promise.all([
    db.select({ id: shifts.id, startedAt: shifts.startedAt, endedAt: shifts.endedAt, projectId: shifts.projectId }).from(shifts)
      .where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), gte(shifts.startedAt, from), lt(shifts.startedAt, to))) as Promise<(ShiftLike & { id: string })[]>,
    projectsOf(db, tenantId),
    notesSince(db, tenantId, userId, from),   // alongside the shifts (one query); only notes on this week's shifts are kept
  ]);
  const names = new Map(projects.map((p) => [p.id, p.name]));
  const lines = statementLines(worked, history, defaults, weekStart, to < new Date() ? to : new Date(), minutesByProject, names, step);
  const ids = new Set(worked.map((w) => w.id));
  const days = daysOf(worked, notes.filter((n) => ids.has(n.shiftId)), to < new Date() ? to : new Date(), projects, settings, step);
  return { week, statement: memberStatement(week, lines, history, defaults, weekStart), weekStart, approved: null, days };
}

/** Freeze the statement as it stands. Approving twice keeps the first approval. */
export async function approve(db: Db, tenantId: string, userId: string, weekStart: string, approverId: string) {
  const s = await statementFor(db, tenantId, userId, weekStart);
  if (!s || s.approved) return s;
  await db.insert(statements).values({ tenantId, userId, weekStart, data: { week: s.week, statement: s.statement, days: s.days }, approvedBy: approverId }).onConflictDoNothing();
  return statementFor(db, tenantId, userId, weekStart);
}
