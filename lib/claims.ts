// Taking a lead before sending it: one person per lead, so two people never send the same email. Everyone sees who
// took what; only the person who took a lead marks it, and an owner or manager can release a lead someone forgot.
// Kept in ramen-agents's own database; nothing here is written to Notion.
import { and, eq } from "drizzle-orm";
import type { Db } from "./db";
import { claims, users } from "./db/schema";
import type { Role } from "./roles";
import { displayName } from "./display-name";

export type Claim = { userId: string; name: string; at: Date };

/** Take a lead, for the email pack (the default) or the WhatsApp one. The first person wins; a second gets who has it.
 *  Taking your own lead again is a no-op. */
export async function accept(db: Db, tenantId: string, pageId: string, userId: string, kind: "email" | "whatsapp" = "email"): Promise<{ ok: true } | { ok: false; takenBy: string }> {
  await db.insert(claims).values({ tenantId, pageId, userId, kind }).onConflictDoNothing();
  const holder = await holderOf(db, tenantId, pageId);
  return holder && holder.userId !== userId ? { ok: false, takenBy: holder.name } : { ok: true };
}

/** Give a lead back: the person who took it, or an owner or manager for anyone's. */
export async function release(db: Db, tenantId: string, pageId: string, by: { userId: string; role: Role }) {
  const holder = await holderOf(db, tenantId, pageId);
  if (!holder) return { ok: true as const };
  if (holder.userId !== by.userId && by.role === "member") return { ok: false as const, error: `Only ${holder.name}, a manager or the owner can release it.` };
  await db.delete(claims).where(and(eq(claims.tenantId, tenantId), eq(claims.pageId, pageId)));
  return { ok: true as const };
}

export async function holderOf(db: Db, tenantId: string, pageId: string): Promise<Claim | null> {
  const [c] = await db
    .select({ userId: claims.userId, name: users.name, email: users.email, at: claims.at })
    .from(claims)
    .innerJoin(users, eq(users.id, claims.userId))
    .where(and(eq(claims.tenantId, tenantId), eq(claims.pageId, pageId)));
  return c ? { userId: c.userId, name: displayName(c.name, c.email), at: c.at } : null;
}

/** Every taken lead in the company, by Notion page id. */
export async function claimsOf(db: Db, tenantId: string): Promise<Map<string, Claim>> {
  const rows = await db
    .select({ pageId: claims.pageId, userId: claims.userId, name: users.name, email: users.email, at: claims.at })
    .from(claims)
    .innerJoin(users, eq(users.id, claims.userId))
    .where(eq(claims.tenantId, tenantId));
  return new Map(rows.map((r) => [r.pageId, { userId: r.userId, name: displayName(r.name, r.email), at: r.at }]));
}

/** Done with a lead (sent): the claim goes, the outcome row keeps who sent it. */
export async function closeClaim(db: Db, tenantId: string, pageId: string) {
  await db.delete(claims).where(and(eq(claims.tenantId, tenantId), eq(claims.pageId, pageId)));
}
