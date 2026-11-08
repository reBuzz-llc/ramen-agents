// The WhatsApp side of the send pack: its WhatsApp tab does the checking and the sending in one place. "Check
// numbers": twenty unchecked numbers taken for the person, best lead score first, each with its wa.me link and Verified / Asked to verify / False number in place.
// "Send on WhatsApp": the person's verified leads (and verified leads nobody holds) with their WhatsApp draft and its open
// flags, Copy, Open in WhatsApp, Mark WhatsApp sent; a verified lead with no draft yet shows "draft coming" (the
// Outreach Writer drafts verified leads first). Every status is set as the person (History); a False number is let go
// (the Validator clears it as before). Nothing is ever sent by the portal. Claims of kind "whatsapp" (the email pack's are "email").
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import { accept, closeClaim } from "./claims";
import type { Db } from "./db";
import { claims, leadFlags, leads } from "./db/schema";
import { WHATSAPP_SENT, writeLead, type Actor } from "./leads";

export const CHECK = 20;
export const SEND = 10;
export const VERIFIED = "WhatsApp Verified";
export const ASKED = "Waiting response for WhatsApp verification";
export const FALSE_NUMBER = "False Whatsapp Number";
export const STATUS_OF = { verified: VERIFIED, asked: ASKED, false: FALSE_NUMBER } as const;
export type CheckStatus = keyof typeof STATUS_OF;

export type WaLead = {
  id: string;
  business: string;
  contact: string | null;
  whatsapp: string | null;
  phone: string | null;
  link: string | null;
  status: string | null;
  draft: string | null;
  flags: { rule: string; detail: string }[];
  mine: boolean;
};

/** The chat link: the lead's wa.me link as it is, else one built from its WhatsApp cell or phone (digits only). */
export function waLink(whatsapp: string | null, phone: string | null): string | null {
  const w = (whatsapp ?? "").trim();
  if (/^https:\/\/(wa\.me|api\.whatsapp\.com)\//i.test(w)) return w;
  const digits = (w || phone || "").replace(/\D/g, "");
  return digits.length >= 8 ? `https://wa.me/${digits}` : null;
}

const hasNumber = or(isNotNull(leads.whatsapp), isNotNull(leads.phone));
const open = and(eq(leads.archived, false), isNull(leads.result), or(isNull(leads.whatsappStatus), ne(leads.whatsappStatus, WHATSAPP_SENT)));
const leadCols = { id: leads.id, business: leads.business, contact: leads.contactPerson, whatsapp: leads.whatsapp, phone: leads.phone, status: leads.whatsappStatus, draft: leads.draftWhatsapp };
type Row = { id: string; business: string; contact: string | null; whatsapp: string | null; phone: string | null; status: string | null; draft: string | null };

async function withFlags(db: Db, tenantId: string, rows: Row[], mine: Set<string>): Promise<WaLead[]> {
  if (!rows.length) return [];
  const flags = await db
    .select({ leadId: leadFlags.leadId, rule: leadFlags.rule, detail: leadFlags.detail })
    .from(leadFlags)
    .where(and(eq(leadFlags.tenantId, tenantId), inArray(leadFlags.leadId, rows.map((r) => r.id)), eq(leadFlags.status, "open")));
  return rows.map((r) => ({
    ...r,
    draft: r.draft && !/^skip\s*:/i.test(r.draft.trim()) ? r.draft : null,
    link: waLink(r.whatsapp, r.phone),
    flags: flags.filter((f) => f.leadId === r.id).map((f) => ({ rule: f.rule, detail: f.detail })),
    mine: mine.has(r.id),
  }));
}

const mineJoin = (tenantId: string, userId: string) =>
  and(eq(claims.tenantId, tenantId), eq(sql`${leads.id}::text`, claims.pageId), eq(claims.userId, userId), eq(claims.kind, "whatsapp"));

/** The person's numbers to check: their WhatsApp claims not checked yet (no status, or asked and waiting). */
export async function checkList(db: Db, tenantId: string, userId: string): Promise<WaLead[]> {
  const rows = await db
    .select(leadCols)
    .from(claims)
    .innerJoin(leads, mineJoin(tenantId, userId))
    .where(and(eq(leads.tenantId, tenantId), open, or(isNull(leads.whatsappStatus), eq(leads.whatsappStatus, ASKED))))
    .orderBy(asc(claims.at), asc(leads.business));
  return withFlags(db, tenantId, rows, new Set(rows.map((r) => r.id)));
}

/** The person's verified leads to send, then verified leads nobody holds, up to ten: drafts first, the rest "draft coming". */
export async function sendList(db: Db, tenantId: string, userId: string): Promise<WaLead[]> {
  const mine = await db
    .select(leadCols)
    .from(claims)
    .innerJoin(leads, mineJoin(tenantId, userId))
    .where(and(eq(leads.tenantId, tenantId), open, eq(leads.whatsappStatus, VERIFIED)))
    .orderBy(asc(claims.at));
  const free =
    mine.length >= SEND
      ? []
      : await db
          .select(leadCols)
          .from(leads)
          .leftJoin(claims, and(eq(claims.tenantId, leads.tenantId), eq(claims.pageId, sql`${leads.id}::text`)))
          .where(and(eq(leads.tenantId, tenantId), open, eq(leads.whatsappStatus, VERIFIED), isNull(claims.userId)))
          .orderBy(sql`(${leads.draftWhatsapp} is not null and ${leads.draftWhatsapp} not ilike 'skip:%') desc`, desc(leads.leadScore), asc(leads.createdAt))
          .limit(SEND - mine.length);
  const rows = [...mine, ...free];
  const list = await withFlags(db, tenantId, rows, new Set(mine.map((r) => r.id)));
  return list.sort((a, b) => Number(!!b.draft) - Number(!!a.draft));
}

/** Top the person's numbers to check up to twenty: unchecked numbers nobody holds, best lead score first. */
export async function fillChecks(db: Db, tenantId: string, userId: string): Promise<number> {
  const have = (await checkList(db, tenantId, userId)).length;
  if (have >= CHECK) return 0;
  const free = await db
    .select({ id: leads.id })
    .from(leads)
    .leftJoin(claims, and(eq(claims.tenantId, leads.tenantId), eq(claims.pageId, sql`${leads.id}::text`)))
    .where(and(eq(leads.tenantId, tenantId), open, hasNumber, isNull(leads.whatsappStatus), isNull(claims.userId)))
    .orderBy(desc(leads.leadScore), asc(leads.createdAt))
    .limit((CHECK - have) * 2);
  let added = 0;
  for (const r of free) {
    if (have + added >= CHECK) break;
    if ((await accept(db, tenantId, r.id, userId, "whatsapp")).ok) added++;
  }
  return added;
}

const actorOf = (who: { userId: string; name: string }): Actor => ({ kind: "person", name: who.name, userId: who.userId });

/** Verified / Asked to verify / False number, as the person, on a number they hold or a free one. A false number is let
 *  go; a verified one stays theirs to send. */
export async function setCheck(db: Db, tenantId: string, leadId: string, status: CheckStatus, who: { userId: string; name: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const [c] = await db.select({ userId: claims.userId }).from(claims).where(and(eq(claims.tenantId, tenantId), eq(claims.pageId, leadId)));
  if (c && c.userId !== who.userId) return { ok: false, error: "Someone else holds this number." };
  const r = await writeLead(db, tenantId, { id: leadId }, { whatsapp_status: STATUS_OF[status] }, actorOf(who));
  if (!r.ok) return { ok: false, error: r.message };
  if (status === "false") await closeClaim(db, tenantId, leadId);
  else if (!c) await accept(db, tenantId, leadId, who.userId, "whatsapp");
  return { ok: true };
}

/** Mark WhatsApp sent as the person (Sent by and Sent at as an email's), let the lead go, and top the checks up. */
export async function markWhatsappSent(db: Db, tenantId: string, leadId: string, who: { userId: string; name: string }): Promise<{ ok: true } | { ok: false; error: string }> {
  const [c] = await db.select({ userId: claims.userId }).from(claims).where(and(eq(claims.tenantId, tenantId), eq(claims.pageId, leadId)));
  if (c && c.userId !== who.userId) return { ok: false, error: "Someone else holds this lead." };
  const [l] = await db.select({ status: leads.whatsappStatus }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
  if (!l) return { ok: false, error: "No such lead." };
  if (l.status !== VERIFIED) return { ok: false, error: "Check the number first: only a verified number is sent to." };
  const r = await writeLead(db, tenantId, { id: leadId }, { whatsapp_status: WHATSAPP_SENT }, actorOf(who));
  if (!r.ok) return { ok: false, error: r.message };
  await closeClaim(db, tenantId, leadId);
  return { ok: true };
}
