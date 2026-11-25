// Taking a lead before sending it: one person per lead, so two people never send the same email. Everyone sees who
// took what; only the person who took a lead marks it, and an owner or manager can release a lead someone forgot.
// Kept in Productive Peek's own database; nothing here is written to Notion.
import { dropFingerprint } from "./board-fp";
import { and, asc, count, eq, sql } from "drizzle-orm";
import type { Db } from "./db";
import { claims, leads, users } from "./db/schema";
import type { Role } from "./roles";
import { displayName } from "./display-name";

export type Claim = { userId: string; name: string; at: Date };
/** A lead neither emailed nor sent on WhatsApp. */
const unsent = sql`coalesce(${leads.emailStatus}, '') <> 'Email Sent' and coalesce(${leads.whatsappStatus}, '') <> 'WhatsApp msg sent'`;

/** Take a lead, for the email pack (the default) or the WhatsApp one. The first person wins; a second gets who has it.
 *  Taking your own lead again is a no-op. */
export async function accept(db: Db, tenantId: string, pageId: string, userId: string, kind: "email" | "whatsapp" = "email"): Promise<{ ok: true } | { ok: false; takenBy: string }> {
  await db.insert(claims).values({ tenantId, pageId, userId, kind }).onConflictDoNothing();
  dropFingerprint(tenantId); // a person took a lead: it shows on their next view (lib/board-fp.ts)
  const holder = await holderOf(db, tenantId, pageId);
  return holder && holder.userId !== userId ? { ok: false, takenBy: holder.name } : { ok: true };
}

/** Give a lead back: the person who took it, or an owner or manager for anyone's. */
export async function release(db: Db, tenantId: string, pageId: string, by: { userId: string; role: Role }) {
  const holder = await holderOf(db, tenantId, pageId);
  if (!holder) return { ok: true as const };
  if (holder.userId !== by.userId && by.role === "member") return { ok: false as const, error: `Only ${holder.name}, a manager or the owner can release it.` };
  await db.delete(claims).where(and(eq(claims.tenantId, tenantId), eq(claims.pageId, pageId)));
  dropFingerprint(tenantId);
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

/** How many leads each person holds right now (This week's "Taken" column): a claim closes when the lead is sent or
 *  given back, so this is what each person has taken and not yet sent, by user id. */
export async function takenCounts(db: Db, tenantId: string): Promise<Map<string, number>> {
  // A lead already sent is not held, whatever older rows say
  const rows = await db.select({ userId: claims.userId, n: count() }).from(claims)
    .leftJoin(leads, and(eq(leads.tenantId, claims.tenantId), eq(sql`${leads.id}::text`, claims.pageId)))
    .where(and(eq(claims.tenantId, tenantId), unsent)).groupBy(claims.userId);
  return new Map(rows.map((r) => [r.userId, Number(r.n)]));
}

export type TakenLead = { id: string; business: string; city: string | null; state: string | null; industry: string | null; kind: string; at: Date };

/** The leads one person holds now (clicking the Taken number shows them), the oldest take first. */
export async function takenLeads(db: Db, tenantId: string, userId: string): Promise<TakenLead[]> {
  return db
    .select({ id: leads.id, business: leads.business, city: leads.city, state: leads.state, industry: leads.industry, kind: claims.kind, at: claims.at })
    .from(claims)
    .innerJoin(leads, and(eq(leads.tenantId, claims.tenantId), eq(sql`${leads.id}::text`, claims.pageId)))
    .where(and(eq(claims.tenantId, tenantId), eq(claims.userId, userId), unsent))
    .orderBy(asc(claims.at), asc(leads.business));
}

/** Done with a lead (sent): the claim goes, the outcome row keeps who sent it. */
export async function closeClaim(db: Db, tenantId: string, pageId: string) {
  await db.delete(claims).where(and(eq(claims.tenantId, tenantId), eq(claims.pageId, pageId)));
}
