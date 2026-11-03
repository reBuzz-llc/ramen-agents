// The team is added by Google address. The owner or a manager enters an email, a name and a role; Peek makes the person's row in the company
// and nothing else: no account, no password. Their first Google sign-in with exactly that address matches the row
// (lib/bootstrap.ts) and they are in. Until then the row reads "invited, not signed in yet". A manager adds and removes
// members only; nobody removes the owner or themselves here. Removing someone who never signed in deletes the row;
// removing someone who did keeps their hours and outcomes and only closes the door (active = false).
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "./db";
import { claims, outcomes, shifts, users } from "./db/schema";
import { setRate } from "./member-rates";
import { dayOf } from "./rates";
import type { Role } from "./roles";
import { settingsOf } from "./tenants";

export type AddRole = Exclude<Role, "owner">;
type Result = { ok: true; member: { id: string; email: string; name: string; role: AddRole; reactivated: boolean } } | { ok: false; error: string };

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export { copyText } from "./team-text";

/** The owner adds members and managers; a manager adds members. */
export const canAdd = (by: Role, to: AddRole) => by === "owner" || (by === "manager" && to === "member");
/** Whom a person may remove: the owner anyone but themself; a manager members only. Never the owner. */
export const canRemove = (by: { id: string; role: Role }, target: { id: string; role: Role }) =>
  target.role !== "owner" && target.id !== by.id && (by.role === "owner" || (by.role === "manager" && target.role === "member"));

export async function addMember(db: Db, tenantId: string, input: { email: string; name: string; role: AddRole }, by: { userId: string; role: Role }): Promise<Result> {
  const email = input.email.trim().toLowerCase();
  const name = input.name.trim().slice(0, 80);
  if (!EMAIL.test(email)) return { ok: false, error: "That is not an email address." };
  if (input.role !== "member" && input.role !== "manager") return { ok: false, error: "A new person is a member or a manager." };
  if (!canAdd(by.role, input.role)) return { ok: false, error: by.role === "manager" ? "Managers add members; the owner adds managers." : "Your role cannot add people." };
  const [on] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (on && on.tenantId !== tenantId) return { ok: false, error: `${email} already belongs to another company here.` };
  if (on && on.active) return { ok: false, error: `${email} is already on the team.` };
  if (on) {
    // Removed earlier: back in, with the role chosen now (their history was kept).
    await db.update(users).set({ active: true, role: input.role, name: name || on.name }).where(eq(users.id, on.id));
    return { ok: true, member: { id: on.id, email, name: name || on.name, role: input.role, reactivated: true } };
  }
  const [u] = await db.insert(users).values({ tenantId, email, name, role: input.role }).returning();
  // The company's default pay rates become theirs from today, so a later change of the defaults doesn't move theirs.
  const defaults = (await settingsOf(db, tenantId)).rates;
  if (defaults && (typeof defaults.hourly === "number" || typeof defaults.outcomeBonus === "number")) {
    await setRate(db, tenantId, u.id, dayOf(new Date()), defaults, by.userId);
  }
  return { ok: true, member: { id: u.id, email, name, role: input.role, reactivated: false } };
}

export async function removeMember(db: Db, tenantId: string, targetId: string, by: { userId: string; role: Role }) {
  const [t] = await db.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, targetId)));
  if (!t || !t.active) return { ok: false as const, error: "No such person on the team." };
  if (!canRemove({ id: by.userId, role: by.role }, t)) return { ok: false as const, error: t.role === "owner" ? "The owner cannot be removed." : "You cannot remove that person." };
  // Taken leads go back to the queue either way.
  await db.delete(claims).where(and(eq(claims.tenantId, tenantId), eq(claims.userId, t.id)));
  const [worked] = await db
    .select({ n: sql<number>`(select count(*) from ${shifts} where ${shifts.userId} = ${t.id}) + (select count(*) from ${outcomes} where ${outcomes.userId} = ${t.id})` })
    .from(users)
    .where(eq(users.id, t.id));
  if (!t.firstSignedInAt && !Number(worked?.n)) {
    await db.delete(users).where(eq(users.id, t.id));
    return { ok: true as const, email: t.email, deleted: true };
  }
  await db.update(users).set({ active: false }).where(eq(users.id, t.id));
  return { ok: true as const, email: t.email, deleted: false };
}

/** The first sign-in of a row added in Settings: stamp it once (later sign-ins change nothing). */
export async function markSignedIn(db: Db, userId: string, at = new Date()) {
  await db.update(users).set({ firstSignedInAt: at }).where(and(eq(users.id, userId), isNull(users.firstSignedInAt)));
}
