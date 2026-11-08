// The send pack: on the Clock home, each person's ten leads to email, already taken for them
// so nobody else sends the same one, each with its draft and its open flags, Copy and Mark sent in place. A pack holds
// the person's taken leads that are not sent and have no result; "Fill my pack" (and every Mark sent) takes the next
// ones from Send next's order that nobody holds, up to ten. Marking sends the lead as the person (Email Sent, result
// Emailed, today) and closes the claim. The owner also sees everyone's packs.
import { and, asc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { accept, closeClaim } from "./claims";
import type { Db } from "./db";
import { claims, leadFlags, leads, users } from "./db/schema";
import { changedSince, lastPersonEdit } from "./draft-edits";
import { attachmentNames } from "./lead-queue";
import { writeLead, type Actor } from "./leads";
import { sendNext } from "./send-next";

export const PACK = 10;

export type PackLead = {
  id: string;
  business: string;
  contact: string | null;
  role: string | null;
  email: string | null;
  draft: string | null;
  pkg: string | null;
  /** The Validator's open flags; `changed`: a person edited the draft after the flag was raised (checked on its next run). */
  flags: { rule: string; detail: string; changed: boolean }[];
  attachments: string[];
  takenAt: string;
};

const notSent = and(eq(leads.archived, false), or(isNull(leads.emailStatus), ne(leads.emailStatus, "Email Sent")), isNull(leads.result));

/** One person's pack: the leads they hold that are not sent and have no result, oldest taken first. */
export async function packOf(db: Db, tenantId: string, userId: string): Promise<PackLead[]> {
  const rows = await db
    .select({ id: leads.id, business: leads.business, contact: leads.contactPerson, role: leads.contactRole, email: leads.businessEmail, draft: leads.draftEmail, pkg: leads.package, takenAt: claims.at })
    .from(claims)
    .innerJoin(leads, and(eq(leads.tenantId, claims.tenantId), eq(sql`${leads.id}::text`, claims.pageId)))
    .where(and(eq(claims.tenantId, tenantId), eq(claims.userId, userId), eq(claims.kind, "email"), notSent))
    .orderBy(asc(claims.at), asc(leads.business));
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const [flags, files, edited] = await Promise.all([
    db.select({ leadId: leadFlags.leadId, rule: leadFlags.rule, detail: leadFlags.detail, firstSeen: leadFlags.firstSeen }).from(leadFlags).where(and(eq(leadFlags.tenantId, tenantId), inArray(leadFlags.leadId, ids), eq(leadFlags.status, "open"))),
    attachmentNames(db, tenantId, ids),
    lastPersonEdit(db, tenantId, ids, "draft_email"),
  ]);
  return rows.map((r) => ({
    ...r,
    takenAt: new Date(r.takenAt).toISOString(),
    flags: flags.filter((f) => f.leadId === r.id).map((f) => ({ rule: f.rule, detail: f.detail, changed: changedSince(f.firstSeen, edited.get(r.id)) })),
    attachments: files.get(r.id) ?? [],
  }));
}

/** Top a person's pack up to ten from Send next's order: leads nobody holds, with a draft. Returns how many were taken. */
export async function fillPack(db: Db, tenantId: string, userId: string): Promise<number> {
  const have = (await packOf(db, tenantId, userId)).length;
  if (have >= PACK) return 0;
  const next = await sendNext(db, tenantId);
  let added = 0;
  for (const r of next.rows) {
    if (have + added >= PACK) break;
    if (r.takenBy || !r.draft || r.emailStatus === "Email Sent") continue;
    const got = await accept(db, tenantId, r.id, userId);
    if (got.ok) added++;
  }
  return added;
}

/** Mark one pack lead sent as the person (the drawer's "Mark email sent" step), close its claim, and top the pack up. */
export async function markPackSent(db: Db, tenantId: string, leadId: string, who: { userId: string; name: string }, now = new Date()): Promise<{ ok: true; added: number } | { ok: false; error: string }> {
  const [c] = await db.select({ userId: claims.userId }).from(claims).where(and(eq(claims.tenantId, tenantId), eq(claims.pageId, leadId)));
  if (!c || c.userId !== who.userId) return { ok: false, error: "This lead is not in your pack any more." };
  const actor: Actor = { kind: "person", name: who.name, userId: who.userId };
  const r = await writeLead(db, tenantId, { id: leadId }, { email_status: "Email Sent", result: "Emailed", result_date: now.toISOString().slice(0, 10) }, actor);
  if (!r.ok) return { ok: false, error: r.message };
  await closeClaim(db, tenantId, leadId);
  return { ok: true, added: await fillPack(db, tenantId, who.userId) };
}

/** Everyone's packs, for the owner: each person holding leads, with how many and which. */
export async function allPacks(db: Db, tenantId: string): Promise<{ userId: string; name: string; leads: { id: string; business: string }[] }[]> {
  const rows = await db
    .select({ userId: claims.userId, name: sql<string>`coalesce(nullif(trim(${users.name}), ''), split_part(${users.email}, '@', 1))`, id: leads.id, business: leads.business })
    .from(claims)
    .innerJoin(users, eq(users.id, claims.userId))
    .innerJoin(leads, and(eq(leads.tenantId, claims.tenantId), eq(sql`${leads.id}::text`, claims.pageId)))
    .where(and(eq(claims.tenantId, tenantId), eq(claims.kind, "email"), notSent))
    .orderBy(asc(users.name), asc(claims.at));
  const by = new Map<string, { userId: string; name: string; leads: { id: string; business: string }[] }>();
  for (const r of rows) {
    const p = by.get(r.userId) ?? { userId: r.userId, name: r.name, leads: [] };
    p.leads.push({ id: r.id, business: r.business });
    by.set(r.userId, p);
  }
  return [...by.values()];
}
