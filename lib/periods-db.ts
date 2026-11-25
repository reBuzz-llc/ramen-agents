// What the period view reads besides the scoreboard: where the data begins, and which weeks' statements are approved. An
// approved statement is only ever listed here, with its mark; a period view never recomputes it.
import { and, eq, inArray, min } from "drizzle-orm";
import type { Db } from "./db";
import { leads, shifts, statements } from "./db/schema";
import { dayIn } from "./send-goals";

/** The first day anything was sent or clocked, in the company's zone; null with no data yet. */
export async function firstDataDay(d: Db, tenantId: string, tz?: string | null): Promise<string | null> {
  const [[sent], [clocked]] = await Promise.all([
    d.select({ at: min(leads.sentAt) }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.archived, false))),
    d.select({ at: min(shifts.startedAt) }).from(shifts).where(eq(shifts.tenantId, tenantId)),
  ]);
  const times = [sent?.at, clocked?.at].filter((x): x is Date => !!x).map((x) => new Date(x).getTime());
  return times.length ? dayIn(new Date(Math.min(...times)), tz) : null;
}

/** The approved statements of these weeks, as `${userId}:${week}`. */
export async function approvedIn(d: Db, tenantId: string, weeks: string[]): Promise<Set<string>> {
  if (!weeks.length) return new Set();
  const rows = await d.select({ userId: statements.userId, week: statements.weekStart }).from(statements).where(and(eq(statements.tenantId, tenantId), inArray(statements.weekStart, weeks)));
  return new Set(rows.map((r) => `${r.userId}:${r.week}`));
}
