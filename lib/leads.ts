// The Leads board in Peek's own database. Every
// write goes through writeLead, which enforces the store's rules and records each cell in lead_cells:
// - person wins: a bot never replaces a cell whose last change was a person's; the attempt is kept, refused;
// - human only: email status, WhatsApp status, result and result date are the team's; a bot writing one is refused;
// - fill only (when the writer asks): a cell that has a value is left alone;
// - an import (the backfill's key) copies Notion as it is, past those rules, and is idempotent on the Notion page id.
// Readers follow `rev`: listLeads(since = the last rev seen) returns what changed after it, in order.
import { and, asc, desc, eq, gt, gte, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "./db";
import { claims, leadCells, leadFlags, leads, users } from "./db/schema";
import { placeOf } from "./lead-filters";
import { e164 } from "./phone";

type Kind = "text" | "number" | "list" | "date" | "json";
type Prop = keyof typeof leads.$inferSelect;
type Field = { key: string; prop: Prop; kind: Kind; human?: boolean };

/** The board's fields under their Neon names, in the board's order. */
export const FIELDS: Field[] = [
  { key: "business", prop: "business", kind: "text" },
  { key: "website", prop: "website", kind: "text" },
  { key: "business_email", prop: "businessEmail", kind: "text" },
  { key: "email_check", prop: "emailCheck", kind: "text" },
  { key: "location", prop: "location", kind: "text" },
  { key: "industry", prop: "industry", kind: "text" },
  { key: "size", prop: "size", kind: "text" },
  { key: "contact_person", prop: "contactPerson", kind: "text" },
  { key: "contact_role", prop: "contactRole", kind: "text" },
  { key: "founder_linkedin", prop: "founderLinkedin", kind: "text" },
  { key: "linkedin_via", prop: "linkedinVia", kind: "text" },
  { key: "whatsapp", prop: "whatsapp", kind: "text" },
  { key: "phone", prop: "phone", kind: "text" },
  { key: "map_link", prop: "mapLink", kind: "text" },
  { key: "pain_point", prop: "painPoint", kind: "text" },
  { key: "package", prop: "package", kind: "text" },
  { key: "evidence", prop: "evidence", kind: "text" },
  { key: "listing_evidence", prop: "listingEvidence", kind: "text" },
  { key: "source_pages", prop: "sourcePages", kind: "text" },
  { key: "tools_on_site", prop: "toolsOnSite", kind: "list" },
  { key: "site_health", prop: "siteHealth", kind: "text" },
  { key: "lead_score", prop: "leadScore", kind: "number" },
  { key: "draft_email", prop: "draftEmail", kind: "text" },
  { key: "draft_whatsapp", prop: "draftWhatsapp", kind: "text" },
  { key: "email_status", prop: "emailStatus", kind: "text", human: true },
  { key: "whatsapp_status", prop: "whatsappStatus", kind: "text", human: true },
  { key: "result", prop: "result", kind: "text", human: true },
  { key: "result_date", prop: "resultDate", kind: "date", human: true },
  { key: "sent_by", prop: "sentBy", kind: "list" },
  { key: "found_by", prop: "foundBy", kind: "text" },
  { key: "notes", prop: "notes", kind: "text" },
  { key: "address", prop: "address", kind: "text" },
  { key: "listing", prop: "listing", kind: "json" },
  { key: "notion_url", prop: "notionUrl", kind: "text" },
  { key: "notion_uid", prop: "notionUid", kind: "text" },
];
const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));

import { EMAIL_STATUSES, WHATSAPP_STATUSES } from "./lead-workflow";
export { EMAIL_STATUSES, RESULTS, WHATSAPP_STATUSES } from "./lead-workflow";

const MAX_TEXT = 20_000;
export const MAX_BATCH = 100;

/** A bot actor's `validator` is set when its key holds board:validate: the one key that may clear a "False Whatsapp
 *  Number" (below). */
export type Actor = { kind: "person"; name: string; userId: string } | { kind: "bot"; name: string; via: string; validator?: boolean };

/** The store's one exception to the team's fields: the Validator may clear the WhatsApp status, and only while it reads
 *  "False Whatsapp Number" (its clean-up once a number proves not to be on WhatsApp). Every other bot write to email
 *  status, WhatsApp status, result or result date stays refused. */
export const validatorClears = (actor: Actor, field: string, old: unknown, value: unknown) =>
  actor.kind === "bot" && !!actor.validator && field === "whatsapp_status" && old === "False Whatsapp Number" && value === null;
export type Refusal = { field: string; reason: "person_wins" | "human_only" | "filled"; current: unknown };
export type Lead = Record<string, unknown> & { id: string; rev: number };
export type WriteResult =
  | { ok: true; created: boolean; lead: Lead; written: string[]; refused: Refusal[]; changes?: number[] }
  | { ok: false; code: "not_found" | "bad_request" | "duplicate_row"; message: string; existingId?: string };

/** "https://www.Acme.example/menu" -> "acme.example". */
export function domainOf(website: string | null | undefined): string | null {
  if (!website) return null;
  try {
    const host = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** A value as stored, or an error message. Empty text and empty lists are null. */
function normalise(f: Field, v: unknown): { value: unknown } | { error: string } {
  if (v === null || v === undefined || v === "") return { value: null };
  if (f.kind === "text") {
    if (typeof v !== "string" && typeof v !== "number") return { error: `${f.key} is text` };
    const s = String(v).trim();
    if (s.length > MAX_TEXT) return { error: `${f.key} is longer than ${MAX_TEXT} characters` };
    if (f.key === "phone") return { value: e164(s) || null };
    return { value: s || null };
  }
  if (f.kind === "number") {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? { value: n } : { error: `${f.key} is a number` };
  }
  if (f.kind === "list") {
    const arr = Array.isArray(v) ? v : String(v).split(",");
    const items = arr.map((x) => String(x ?? "").trim()).filter(Boolean);
    return { value: items.length ? items : null };
  }
  if (f.kind === "json") {
    let o: unknown = v;
    if (typeof v === "string") {
      try {
        o = JSON.parse(v);
      } catch {
        return { error: `${f.key} is a JSON object` };
      }
    }
    if (!o || typeof o !== "object" || Array.isArray(o)) return { error: `${f.key} is a JSON object` };
    return JSON.stringify(o).length > MAX_TEXT ? { error: `${f.key} is too long` } : { value: o };
  }
  const d = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? { value: d } : { error: `${f.key} is a date (YYYY-MM-DD)` };
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/** Notion's Status list ("Email Sent", "WhatsApp Verified") as the two fields; values in neither track are refused. */
export function splitStatus(v: unknown): { email_status: string | null; whatsapp_status: string | null } | { error: string } {
  const items = (Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean);
  const unknown = items.filter((x) => !EMAIL_STATUSES.includes(x) && !WHATSAPP_STATUSES.includes(x));
  if (unknown.length) return { error: `status has values outside both tracks: ${unknown.join(", ")}` };
  const join = (xs: string[]) => (xs.length ? xs.join(", ") : null);
  return { email_status: join(items.filter((x) => EMAIL_STATUSES.includes(x))), whatsapp_status: join(items.filter((x) => WHATSAPP_STATUSES.includes(x))) };
}

/** The draft cells whose bot text is kept when a person rewrites it, and the row's field for it. */
export const BOT_SNAPSHOT: Record<string, "botDraft" | "botWhatsapp"> = { draft_email: "botDraft", draft_whatsapp: "botWhatsapp" };

/** A row as the API answers it: every field under its Neon name, Notion's combined `status`, and the row's meta. */
export function toApi(r: typeof leads.$inferSelect): Lead {
  const out: Lead = { id: r.id, notion_page_id: r.notionPageId, rev: Number(r.rev) };
  for (const f of FIELDS) out[f.key] = r[f.prop] ?? null;
  const status = [...(r.emailStatus?.split(", ") ?? []), ...(r.whatsappStatus?.split(", ") ?? [])];
  Object.assign(out, {
    status: status.length ? status : null,
    domain: r.domain,
    city: r.city,
    state: r.state,
    sent_at: r.sentAt?.toISOString() ?? null,
    archived: r.archived,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
    last_edited_by: r.lastActorName ? { actor: r.lastActorName, kind: r.lastActorKind } : null,
    // the bot's draft before a person rewrote it (read only; the training scripts pair it with the sent text)
    bot_draft: r.botDraft ?? null,
    bot_whatsapp: r.botWhatsapp ?? null,
  });
  return out;
}

/**
 * Write one lead: an update to the row found by `target`, or, when there is none and `create` is set, a new row.
 * `input` holds fields under their Neon names (and Notion's `status` list, split here). Returns what was written and
 * what was refused, with the row as stored, from the same transaction.
 */
export async function writeLead(
  db: Db,
  tenantId: string,
  target: { id?: string; notionPageId?: string },
  input: Record<string, unknown>,
  actor: Actor,
  opts: { create?: boolean; fillOnly?: boolean; import?: boolean; sourceUrl?: string | null } = {},
): Promise<WriteResult> {
  // Read and check the input before touching the database.
  const raw = { ...input };
  if ("status" in raw) {
    const s = splitStatus(raw.status);
    if ("error" in s) return { ok: false, code: "bad_request", message: s.error };
    delete raw.status;
    raw.email_status ??= s.email_status;
    raw.whatsapp_status ??= s.whatsapp_status;
  }
  const want = new Map<Field, unknown>();
  for (const [k, v] of Object.entries(raw)) {
    if (["id", "notion_page_id", "rev", "domain", "city", "state", "sent_at", "archived", "updated_at", "last_edited_by"].includes(k)) continue;
    if (k === "created_at") continue; // an import's created_at is read below
    const f = BY_KEY.get(k);
    if (!f) return { ok: false, code: "bad_request", message: `unknown field: ${k}` };
    const n = normalise(f, v);
    if ("error" in n) return { ok: false, code: "bad_request", message: n.error };
    want.set(f, n.value);
  }
  const createdAt = opts.import && typeof input.created_at === "string" && !Number.isNaN(Date.parse(input.created_at)) ? new Date(input.created_at) : null;
  if (!target.id && !target.notionPageId && !opts.create) return { ok: false, code: "bad_request", message: "a lead is named by its id or its notion_page_id" };
  if (target.id && !/^[0-9a-f-]{36}$/i.test(target.id)) return { ok: false, code: "not_found", message: `no lead ${target.id}` };
  const sourceUrl = opts.sourceUrl ? String(opts.sourceUrl).slice(0, 2000) : null;

  return db.transaction(async (tx) => {
    const where = target.id ? eq(leads.id, target.id) : target.notionPageId ? eq(leads.notionPageId, target.notionPageId) : null;
    const [cur] = where ? await tx.select().from(leads).where(and(eq(leads.tenantId, tenantId), where)).for("update") : [];
    const now = new Date();
    const history: (typeof leadCells.$inferInsert)[] = [];
    const who = {
      actorKind: actor.kind,
      actorName: actor.name.slice(0, 80),
      actorUserId: actor.kind === "person" ? actor.userId : null,
      via: actor.kind === "bot" ? actor.via : null,
      sourceUrl,
    };
    const refused: Refusal[] = [];

    if (!cur) {
      if (!opts.create) return { ok: false as const, code: "not_found" as const, message: `no lead ${target.id ?? target.notionPageId}` };
      const business = want.get(BY_KEY.get("business")!);
      if (!business) return { ok: false as const, code: "bad_request" as const, message: "a new lead needs business" };
      const values: Record<string, unknown> = {};
      for (const [f, v] of want) {
        if (v === null) continue;
        if (!opts.import && actor.kind === "bot" && f.human) {
          refused.push({ field: f.key, reason: "human_only", current: null });
          continue;
        }
        values[f.prop] = v;
      }
      const domain = domainOf(values.website as string | undefined);
      if (!opts.import) {
        // One row per business: the same website domain, or with no website the same name and city, is refused.
        const city = values.location ? placeOf(String(values.location)).city : "";
        const dup = await tx
          .select({ id: leads.id })
          .from(leads)
          .where(and(eq(leads.tenantId, tenantId), domain ? eq(leads.domain, domain) : and(ilike(leads.business, String(business)), city ? ilike(leads.city, city) : isNull(leads.city))))
          .limit(1);
        if (dup[0]) return { ok: false as const, code: "duplicate_row" as const, message: `${business} is already on the board`, existingId: dup[0].id };
      }
      const place = values.location ? placeOf(String(values.location)) : null;
      const [row] = await tx
        .insert(leads)
        .values({
          ...(values as Partial<typeof leads.$inferInsert>),
          business: String(values.business),
          tenantId,
          notionPageId: target.notionPageId ?? null,
          domain,
          city: place?.city || null,
          state: place?.state || null,
          sentAt: values.emailStatus === "Email Sent" && !opts.import ? now : null,
          lastActorName: who.actorName,
          lastActorKind: who.actorKind,
          ...(createdAt ? { createdAt } : {}),
        })
        .returning();
      for (const f of FIELDS) if (values[f.prop] !== undefined) history.push({ tenantId, leadId: row.id, column: f.key, old: null, new: values[f.prop] as object, ...who });
      for (const r of refused) history.push({ tenantId, leadId: row.id, column: r.field, old: null, new: want.get(BY_KEY.get(r.field)!) as object, ...who, outcome: "refused", reason: r.reason });
      if (history.length) await tx.insert(leadCells).values(history);
      return { ok: true as const, created: true, lead: toApi(row), written: Object.keys(values).map((p) => FIELDS.find((f) => f.prop === p)!.key), refused };
    }

    // The last applied change of each field: for the person-wins rule (a bot's write), and for the bot's draft kept when
    // a person rewrites it (a person's write of a draft cell).
    const lastBy = new Map<string, string>();
    const draftEdit = actor.kind === "person" && [...want.keys()].some((f) => f.key in BOT_SNAPSHOT);
    if ((actor.kind === "bot" || draftEdit) && !opts.import) {
      const past = await tx
        .select({ column: leadCells.column, kind: leadCells.actorKind })
        .from(leadCells)
        .where(and(eq(leadCells.leadId, cur.id), eq(leadCells.outcome, "applied")))
        .orderBy(desc(leadCells.id));
      for (const p of past) if (!lastBy.has(p.column)) lastBy.set(p.column, p.kind);
    }
    const set: Record<string, unknown> = {};
    const written: string[] = [];
    for (const [f, v] of want) {
      const old = cur[f.prop] ?? null;
      if (same(old, v)) continue;
      let reason: Refusal["reason"] | null = null;
      if (!opts.import && !validatorClears(actor, f.key, old, v)) {
        if (actor.kind === "bot" && f.human) reason = "human_only";
        else if (actor.kind === "bot" && lastBy.get(f.key) === "person") reason = "person_wins";
        else if (opts.fillOnly && old !== null) reason = "filled";
      }
      if (reason) {
        refused.push({ field: f.key, reason, current: old });
        history.push({ tenantId, leadId: cur.id, column: f.key, old: old as object, new: v as object, ...who, outcome: "refused", reason });
        continue;
      }
      set[f.prop] = v;
      written.push(f.key);
      history.push({ tenantId, leadId: cur.id, column: f.key, old: old as object, new: v as object, ...who });
      // a person rewriting a bot's draft: keep the bot's text beside it (a person's later edits leave it alone)
      const snap = BOT_SNAPSHOT[f.key];
      if (snap && actor.kind === "person" && !opts.import && old !== null && lastBy.get(f.key) === "bot") set[snap] = old;
    }
    if (createdAt && cur.createdAt.getTime() !== createdAt.getTime()) set.createdAt = createdAt;
    if (!Object.keys(set).length) {
      if (history.length) await tx.insert(leadCells).values(history);
      return { ok: true as const, created: false, lead: toApi(cur), written, refused };
    }
    if ("website" in set) set.domain = domainOf(set.website as string | null);
    if ("location" in set) {
      const p = set.location ? placeOf(String(set.location)) : null;
      set.city = p?.city || null;
      set.state = p?.state || null;
    }
    if (set.emailStatus === "Email Sent" && !cur.sentAt && !opts.import) {
      set.sentAt = now;
      history.push({ tenantId, leadId: cur.id, column: "sent_at", old: null, new: now.toISOString() as unknown as object, ...who });
      // Sent by is the person who marked it sent, never a bot (the Validator guessed it from Notion until now).
      if (actor.kind === "person" && !cur.sentBy?.length && !("sentBy" in set)) {
        set.sentBy = [actor.name];
        history.push({ tenantId, leadId: cur.id, column: "sent_by", old: null, new: set.sentBy as object, ...who });
      }
    }
    const [row] = await tx
      .update(leads)
      .set({ ...(set as Partial<typeof leads.$inferInsert>), updatedAt: now, rev: sql`nextval('leads_rev_seq')`, lastActorName: who.actorName, lastActorKind: who.actorKind })
      .where(eq(leads.id, cur.id))
      .returning();
    // The ids of the changes applied here: what an Undo of this step restores (undoChanges).
    const saved = history.length ? await tx.insert(leadCells).values(history).returning() : [];
    return { ok: true as const, created: false, lead: toApi(row), written, refused, changes: saved.filter((h) => h.outcome === "applied").map((h) => Number(h.id)) };
  });
}

export type BatchWrite = { id?: string; notion_page_id?: string; fields: Record<string, unknown>; create?: boolean; fill_only?: boolean; source_url?: string };

/** Several writes, each on its own (one refusal or failure never undoes another), answered in order. */
export async function batchWrite(db: Db, tenantId: string, writes: BatchWrite[], actor: Actor, opts: { import?: boolean } = {}) {
  if (!Array.isArray(writes) || !writes.length) return { ok: false as const, code: "bad_request" as const, message: "writes is a non-empty list" };
  if (writes.length > MAX_BATCH) return { ok: false as const, code: "too_large" as const, message: `at most ${MAX_BATCH} writes a batch` };
  const results: WriteResult[] = [];
  for (const w of writes) {
    if (!w || typeof w !== "object" || typeof w.fields !== "object" || !w.fields) {
      results.push({ ok: false, code: "bad_request", message: "each write has fields" });
      continue;
    }
    results.push(
      await writeLead(db, tenantId, { id: w.id, notionPageId: w.notion_page_id }, w.fields, actor, {
        create: !!w.create,
        fillOnly: !!w.fill_only,
        import: opts.import,
        sourceUrl: w.source_url,
      }),
    );
  }
  return { ok: true as const, results };
}

export type LeadQuery = {
  since?: number;
  limit?: number;
  emailStatus?: string;
  whatsappStatus?: string;
  city?: string;
  industry?: string;
  minScore?: number;
  hasDraft?: boolean;
  hasRole?: boolean;
  archived?: boolean;
};

/** Leads in `rev` order after `since` (0 for all), with the filters given: {leads, next}. `next` is the last rev
 *  returned (ask again with since = next), or the same `since` when nothing changed; `more` says a page was cut. */
export async function listLeads(db: Db, tenantId: string, q: LeadQuery = {}) {
  const limit = Math.min(Math.max(Math.floor(q.limit ?? 100), 1), 500);
  const since = Math.max(Math.floor(q.since ?? 0), 0);
  const where: SQL[] = [eq(leads.tenantId, tenantId), gt(leads.rev, since)];
  if (!q.archived) where.push(eq(leads.archived, false));
  if (q.emailStatus) where.push(q.emailStatus === "none" ? isNull(leads.emailStatus) : eq(leads.emailStatus, q.emailStatus));
  if (q.whatsappStatus) where.push(q.whatsappStatus === "none" ? isNull(leads.whatsappStatus) : eq(leads.whatsappStatus, q.whatsappStatus));
  if (q.city) where.push(ilike(leads.city, q.city));
  if (q.industry) where.push(ilike(leads.industry, `%${q.industry.replace(/[%_\\]/g, "")}%`));
  if (typeof q.minScore === "number" && Number.isFinite(q.minScore)) where.push(gte(leads.leadScore, q.minScore));
  if (q.hasDraft !== undefined) where.push(q.hasDraft ? and(isNotNull(leads.draftEmail), sql`${leads.draftEmail} not ilike 'skip:%'`)! : or(isNull(leads.draftEmail), sql`${leads.draftEmail} ilike 'skip:%'`)!);
  if (q.hasRole !== undefined) where.push(q.hasRole ? isNotNull(leads.contactRole) : isNull(leads.contactRole));
  const rows = await db.select().from(leads).where(and(...where)).orderBy(asc(leads.rev)).limit(limit + 1);
  const page = rows.slice(0, limit);
  return { leads: page.map(toApi), next: page.length ? Number(page[page.length - 1].rev) : since, more: rows.length > limit };
}

export async function getLead(db: Db, tenantId: string, target: { id?: string; notionPageId?: string }) {
  if (target.id && !/^[0-9a-f-]{36}$/i.test(target.id)) return null;
  const where = target.id ? eq(leads.id, target.id) : target.notionPageId ? eq(leads.notionPageId, target.notionPageId) : null;
  if (!where) return null;
  const [r] = await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), where));
  return r ? toApi(r) : null;
}

/** A lead's history, newest first: every applied change and every refused attempt. */
export async function historyOf(db: Db, tenantId: string, leadId: string, limit = 500) {
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return [];
  const rows = await db
    .select()
    .from(leadCells)
    .where(and(eq(leadCells.tenantId, tenantId), eq(leadCells.leadId, leadId)))
    .orderBy(desc(leadCells.id))
    .limit(Math.min(limit, 2000));
  return rows.map((h) => ({
    id: h.id,
    column: h.column,
    old: h.old,
    new: h.new,
    actor: { kind: h.actorKind, name: h.actorName, via: h.via },
    at: h.at.toISOString(),
    source_url: h.sourceUrl,
    outcome: h.outcome,
    reason: h.reason,
  }));
}

/** For the board page: every lead's list columns (no draft text), best score first, with who took it, whether the
 *  signed-in person took or changed it ("Mine"), and whether the team corrected a bot on it: a person's applied change
 *  to a cell whose earlier applied change was a bot's ("Corrected by the team"). */
export async function boardOf(db: Db, tenantId: string, userId: string) {
  return db
    .select(boardColumns(userId))
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.archived, false)))
    .orderBy(sql`${leads.leadScore} desc nulls last`, desc(leads.updatedAt));
}

/** A long cell cut in the database to what a table cell shows; the drawer reads the whole lead. */
const cut = (c: AnyPgColumn, n = 160) => sql<string | null>`left(${c}, ${sql.raw(String(n))})`;

/** For the Table tab: the board's columns and every other
 *  cell, long text cut to its first 160 characters (a draft's to 120), in the board's order. */
export async function tableOf(db: Db, tenantId: string, userId: string) {
  return db
    .select({
      ...boardColumns(userId),
      location: leads.location,
      businessEmail: leads.businessEmail,
      emailCheck: leads.emailCheck,
      size: leads.size,
      founderLinkedin: leads.founderLinkedin,
      linkedinVia: leads.linkedinVia,
      whatsapp: leads.whatsapp,
      phone: leads.phone,
      mapLink: leads.mapLink,
      painPoint: cut(leads.painPoint),
      draftEmail: cut(leads.draftEmail, 120),
      draftWhatsapp: cut(leads.draftWhatsapp, 120),
      evidence: cut(leads.evidence),
      sourcePages: cut(leads.sourcePages),
      toolsOnSite: leads.toolsOnSite,
      siteHealth: cut(leads.siteHealth),
      resultDate: leads.resultDate,
      sentAt: leads.sentAt,
      foundBy: leads.foundBy,
      notes: cut(leads.notes),
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.archived, false)))
    .orderBy(sql`${leads.leadScore} desc nulls last`, desc(leads.updatedAt));
}

/** The board's list columns, shared by the Board and Table tabs. */
function boardColumns(userId: string) {
  return {
    id: leads.id,
    business: leads.business,
    website: leads.website,
    city: leads.city,
    state: leads.state,
    industry: leads.industry,
    contactPerson: leads.contactPerson,
    contactRole: leads.contactRole,
    package: leads.package,
    leadScore: leads.leadScore,
    emailStatus: leads.emailStatus,
    whatsappStatus: leads.whatsappStatus,
    result: leads.result,
    sentBy: leads.sentBy,
    hasDraft: sql<boolean>`${leads.draftEmail} is not null and ${leads.draftEmail} not ilike 'skip:%'`,
    updatedAt: leads.updatedAt,
    takenBy: sql<string | null>`(select coalesce(nullif(u.name, ''), u.email) from ${claims} c join ${users} u on u.id = c.user_id where c.tenant_id = "leads"."tenant_id" and c.page_id = "leads"."id"::text)`,
    mine: sql<boolean>`exists (select 1 from ${claims} c where c.tenant_id = "leads"."tenant_id" and c.page_id = "leads"."id"::text and c.user_id = ${userId})
      or exists (select 1 from ${leadCells} m where m.lead_id = "leads"."id" and m.actor_user_id = ${userId} and m.outcome = 'applied')`,
    openFlags: sql<number>`(select count(*)::int from ${leadFlags} f where f.lead_id = "leads"."id" and f.status = 'open')`,
    corrected: sql<boolean>`exists (select 1 from ${leadCells} p where p.lead_id = "leads"."id" and p.actor_kind = 'person' and p.outcome = 'applied'
      and exists (select 1 from ${leadCells} b where b.lead_id = p.lead_id and b."column" = p."column" and b.actor_kind = 'bot' and b.outcome = 'applied' and b.id < p.id))`,
  };
}


/** The × on a status chip: empty that status cell, and with it the cells the same
 *  step set (sent by, sent at, result, result date), when they still hold what that step wrote. One history entry by
 *  the person ("cleared"). Answers what was cleared; nothing when the status is already empty. */
export const CLEARABLE = ["email_status", "whatsapp_status", "result"] as const;
const COMPANIONS = ["sent_by", "sent_at", "result", "result_date", "email_status"];

export async function clearStatus(db: Db, tenantId: string, leadId: string, field: (typeof CLEARABLE)[number], actor: Extract<Actor, { kind: "person" }>) {
  if (!CLEARABLE.includes(field) || !/^[0-9a-f-]{36}$/i.test(leadId)) return { ok: false as const, error: "Nothing to clear." };
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId))).for("update");
    if (!cur) return { ok: false as const, error: "No such lead." };
    const valueOf = (col: string) => (col === "sent_at" ? (cur.sentAt?.toISOString() ?? null) : (cur[BY_KEY.get(col)!.prop] ?? null));
    if (valueOf(field) === null) return { ok: false as const, error: "That status is already empty." };
    // The step that set this status: its applied change, and the other cells written in the same write.
    const past = await tx.select().from(leadCells).where(and(eq(leadCells.leadId, leadId), eq(leadCells.outcome, "applied"))).orderBy(desc(leadCells.id));
    const setter = past.find((h) => h.column === field && same(h.new, valueOf(field)));
    const clear = new Set<string>([field]);
    if (setter) {
      for (const h of past) {
        if (h.at.getTime() !== setter.at.getTime() || h.actorName !== setter.actorName || !COMPANIONS.includes(h.column) || h.column === field) continue;
        if (same(h.new, valueOf(h.column))) clear.add(h.column);
      }
    }
    const set: Record<string, unknown> = {};
    const was: Record<string, unknown> = {};
    for (const col of clear) {
      was[col] = valueOf(col);
      set[col === "sent_at" ? "sentAt" : BY_KEY.get(col)!.prop] = null;
    }
    const [row] = await tx
      .update(leads)
      .set({ ...(set as Partial<typeof leads.$inferInsert>), updatedAt: new Date(), rev: sql`nextval('leads_rev_seq')`, lastActorName: actor.name, lastActorKind: "person" })
      .where(eq(leads.id, cur.id))
      .returning();
    await tx.insert(leadCells).values({
      tenantId,
      leadId,
      column: "cleared",
      old: was as object,
      new: Object.fromEntries([...clear].map((c) => [c, null])) as object,
      actorKind: "person",
      actorName: actor.name.slice(0, 80),
      actorUserId: actor.userId,
      reason: "cleared",
    });
    return { ok: true as const, lead: toApi(row), cleared: [...clear] };
  });
}
