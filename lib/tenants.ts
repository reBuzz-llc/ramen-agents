// Companies and their people. Every read takes a tenantId first, so a query cannot reach
// another company's rows by forgetting a filter.
import { and, eq, gte, isNull } from "drizzle-orm";
import type { Db } from "./db";
import { outcomes, shifts, tenants, users, type TenantSettings } from "./db/schema";
import type { Role } from "./roles";

export async function createTenant(db: Db, name: string, slug: string, owner: { email: string; name: string }) {
  const [t] = await db.insert(tenants).values({ name, slug }).returning();
  const [u] = await db.insert(users).values({ tenantId: t.id, email: owner.email.toLowerCase(), name: owner.name, role: "owner" }).returning();
  return { tenant: t, owner: u };
}

export async function addUser(db: Db, tenantId: string, email: string, name: string, role: Exclude<Role, "owner"> = "member") {
  const [u] = await db.insert(users).values({ tenantId, email: email.toLowerCase(), name, role }).returning();
  return u;
}

export async function userByEmail(db: Db, tenantId: string, email: string) {
  const [u] = await db.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.email, email.toLowerCase())));
  return u ?? null;
}

export async function settingsOf(db: Db, tenantId: string): Promise<TenantSettings> {
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return t?.settings ?? {};
}

// ---- the clock -------------------------------------------------------------------------------------------------

export async function shiftsSince(db: Db, tenantId: string, userId: string, since: Date) {
  return db.select().from(shifts).where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), gte(shifts.startedAt, since)));
}

/** Clock in to a project (null is General; the caller checks the project is the company's and active). */
export async function clockIn(db: Db, tenantId: string, userId: string, at = new Date(), projectId: string | null = null) {
  const open = await db.select().from(shifts).where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), isNull(shifts.endedAt)));
  if (open.length) return { ok: false as const, reason: "already clocked in" };
  const [s] = await db.insert(shifts).values({ tenantId, userId, startedAt: at, projectId }).returning();
  return { ok: true as const, shift: s };
}

/** Switch project mid-day: the open shift closes and a new one opens on the other project at the same moment, so the
 *  day has no gap. Switching to the project already running does nothing. */
export async function switchProject(db: Db, tenantId: string, userId: string, projectId: string | null, at = new Date()) {
  return db.transaction(async (tx) => {
    const [open] = await tx.select().from(shifts).where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), isNull(shifts.endedAt)));
    if (!open) return { ok: false as const, reason: "not clocked in" };
    if ((open.projectId ?? null) === projectId) return { ok: true as const, shift: open };
    await tx.update(shifts).set({ endedAt: at }).where(eq(shifts.id, open.id));
    const [s] = await tx.insert(shifts).values({ tenantId, userId, startedAt: at, projectId }).returning();
    return { ok: true as const, shift: s };
  });
}

export async function clockOut(db: Db, tenantId: string, userId: string, at = new Date(), note = "") {
  const [s] = await db
    .update(shifts)
    .set({ endedAt: at, note })
    .where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), isNull(shifts.endedAt)))
    .returning();
  return s ? { ok: true as const, shift: s } : { ok: false as const, reason: "not clocked in" };
}

export async function recordOutcome(db: Db, tenantId: string, userId: string | null, pageId: string, kind: "reviewed" | "sent") {
  await db.insert(outcomes).values({ tenantId, userId, pageId, kind });
}
