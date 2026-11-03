// Who may sign in. The very first sign-in on an empty database creates the first company and makes that person its
// owner. After that, only a person the owner
// added can sign in; an unknown email is refused, whatever the sign-in method.
import { eq, sql } from "drizzle-orm";
import type { Db } from "./db";
import { tenants, users } from "./db/schema";
import { createTenant } from "./tenants";

export const FIRST_TENANT = { name: "My team", slug: "team" };

export async function userForSignIn(db: Db, email: string, name = "") {
  const e = email.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return { ok: false as const, reason: "that is not an email address" };
  let [u] = await db.select().from(users).where(eq(users.email, e)).limit(1);
  if (!u) {
    // The first sign-in on an empty database creates the company. Several requests of that first page load arrive at
    // once (the page and its layout), so the check and the insert run under one advisory lock, one request at a time.
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(7240001)`);
      const anyTenant = await tx.select({ id: tenants.id }).from(tenants).limit(1);
      if (anyTenant.length) return null;
      const { owner } = await createTenant(tx as unknown as Db, FIRST_TENANT.name, FIRST_TENANT.slug, { email: e, name });
      return owner;
    });
    if (created) return { ok: true as const, user: created, created: true };
    [u] = await db.select().from(users).where(eq(users.email, e)).limit(1);
  }
  if (!u || !u.active) return { ok: false as const, reason: "no account for that email: ask your company's owner or a manager to add your Google address" };
  return { ok: true as const, user: u, created: false };
}
