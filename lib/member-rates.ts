// Reading and adding a person's pay rates (the database side of lib/rates.ts). Rows are only ever added: a change is a
// new row from a date on, so history and past statements stay as they were.
import { and, asc, eq } from "drizzle-orm";
import type { Db } from "./db";
import { memberRates, statements } from "./db/schema";
import type { RateRow } from "./rates";
import type { Rates } from "./scoreboard";

const toCents = (n: number | undefined) => (typeof n === "number" ? Math.round(n * 100) : null);
const fromCents = (c: number | null) => (c === null ? null : c / 100);

export async function rateHistory(db: Db, tenantId: string, userId: string): Promise<RateRow[]> {
  const rows = await db.select().from(memberRates).where(and(eq(memberRates.tenantId, tenantId), eq(memberRates.userId, userId))).orderBy(asc(memberRates.effectiveFrom));
  return rows.map((r) => ({ effectiveFrom: r.effectiveFrom, hourly: fromCents(r.hourlyCents), outcomeBonus: fromCents(r.outcomeBonusCents), currency: r.currency }));
}

/** Every person's history at once, for the People list: userId -> rows (oldest first). */
export async function rateHistories(db: Db, tenantId: string): Promise<Map<string, RateRow[]>> {
  const rows = await db.select().from(memberRates).where(eq(memberRates.tenantId, tenantId)).orderBy(asc(memberRates.effectiveFrom));
  const out = new Map<string, RateRow[]>();
  for (const r of rows) {
    const list = out.get(r.userId) ?? [];
    list.push({ effectiveFrom: r.effectiveFrom, hourly: fromCents(r.hourlyCents), outcomeBonus: fromCents(r.outcomeBonusCents), currency: r.currency });
    out.set(r.userId, list);
  }
  return out;
}

/**
 * A new rate for a person from `effectiveFrom` on. The same day twice replaces that day's row (a typo fixed the same
 * day); any other day adds a row. An approved statement is frozen and never re-read, so it never moves.
 */
export async function setRate(db: Db, tenantId: string, userId: string, effectiveFrom: string, rates: Rates, setBy: string) {
  const row = { tenantId, userId, effectiveFrom, hourlyCents: toCents(rates.hourly), outcomeBonusCents: toCents(rates.outcomeBonus), currency: (rates.currency || "USD").toUpperCase().slice(0, 3), setBy };
  await db
    .insert(memberRates)
    .values(row)
    .onConflictDoUpdate({ target: [memberRates.tenantId, memberRates.userId, memberRates.effectiveFrom], set: { hourlyCents: row.hourlyCents, outcomeBonusCents: row.outcomeBonusCents, currency: row.currency, setBy } });
}

/** Each person's approved statements' weeks (userId -> week starts), for the rates they lock (lib/rates.ts rateLocks). */
export async function approvedWeeks(db: Db, tenantId: string): Promise<Map<string, string[]>> {
  const rows = await db.select({ userId: statements.userId, weekStart: statements.weekStart }).from(statements).where(eq(statements.tenantId, tenantId));
  const out = new Map<string, string[]>();
  for (const r of rows) out.set(r.userId, [...(out.get(r.userId) ?? []), r.weekStart]);
  return out;
}

/** Remove one of a person's rates: only one no approved statement lies under (the caller checks rateLocks). */
export async function removeRate(db: Db, tenantId: string, userId: string, effectiveFrom: string) {
  await db.delete(memberRates).where(and(eq(memberRates.tenantId, tenantId), eq(memberRates.userId, userId), eq(memberRates.effectiveFrom, effectiveFrom)));
}
