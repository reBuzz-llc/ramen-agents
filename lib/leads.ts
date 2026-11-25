// The Leads board in Peek's own database (columns: the engine's common-data/leads-columns.md). Every
// write goes through writeLead, which enforces the store's rules and records each cell in lead_cells:
// - person wins: a bot never replaces a cell whose last change was a person's; the attempt is kept, refused;
// - human only: email status, WhatsApp status, result, result date and the follow-up sent (follow_up_at, follow_up_by)
//   are the team's; a bot writing one is refused;
// - fill only (when the writer asks): a cell that has a value is left alone;
// - an import (the backfill's key) copies Notion as it is, past those rules, and is idempotent on the Notion page id.
// Readers follow `rev`: listLeads(since = the last rev seen) returns what changed after it, in order.
import { mergeDrafts, readStepInput, type StepInput, type StepKey } from "./follow-up-drafts";
import { dropFingerprint } from "./board-fp";
import { closeClaim } from "./claims";
import { and, asc, desc, eq, gt, gte, ilike, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Db } from "./db";
import { syncLeadSends } from "./lead-sends";
import { onLeadWrite } from "./samples";
import { claims, leadCells, leadFlags, leads, tasks, users } from "./db/schema";
import { placeOf } from "./lead-filters";
import { FENCED, isListed } from "./research-first";
import { saveWarning } from "./pain-point-check";
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
  { key: "sample_url", prop: "sampleUrl", kind: "text", human: true },
  { key: "instagram_url", prop: "instagramUrl", kind: "text" },
  { key: "facebook_url", prop: "facebookUrl", kind: "text" },
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
  { key: "draft_followup", prop: "draftFollowup", kind: "text" },
  { key: "follow_up_at", prop: "followUpAt", kind: "date", human: true },
  { key: "follow_up_by", prop: "followUpBy", kind: "list", human: true },
  { key: "found_by", prop: "foundBy", kind: "text" },
  { key: "notes", prop: "notes", kind: "text" },
  { key: "address", prop: "address", kind: "text" },
  { key: "listing", prop: "listing", kind: "json" },
  { key: "notion_url", prop: "notionUrl", kind: "text" },
  { key: "notion_uid", prop: "notionUid", kind: "text" },
];
const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));
import { isSampleUrl } from "./sample-site";

import { EMAIL_STATUSES, WHATSAPP_STATUSES } from "./lead-workflow";
export const WHATSAPP_SENT = "WhatsApp msg sent";
export { EMAIL_STATUSES, RESULTS, WHATSAPP_STATUSES } from "./lead-workflow";

const MAX_TEXT = 20_000;

/** A bot actor's `validator` is set when its key holds board:validate: the one key that may clear a "False Whatsapp
 *  Number" (below). */
export type Actor = { kind: "person"; name: string; userId: string } | { kind: "bot"; name: string; via: string; validator?: boolean };

/** The store's one exception to the team's fields: the Validator may clear the WhatsApp status, and only while it reads
 *  "False Whatsapp Number" (its clean-up once a number proves not to be on WhatsApp). Every other bot write to email
 *  status, WhatsApp status, result or result date stays refused. */
export const validatorClears = (actor: Actor, field: string, old: unknown, value: unknown) =>
  actor.kind === "bot" && !!actor.validator && field === "whatsapp_status" && old === "False Whatsapp Number" && value === null;
export type Refusal = { field: string; reason: "person_wins" | "human_only" | "filled" | "derived" | "research_first"; current: unknown };
/** Cells Peek works out from others (domain from website, city and state from location): a write to one is refused as
 *  "derived", never a silent 200. */
export const DERIVED = ["domain", "city", "state"];
export type Lead = Record<string, unknown> & { id: string; rev: number };
/** What a late caller gets for naming a row by its old Notion page id (the column was dropped, Peek 601, 11-20). */
export const NOTION_GONE = "notion_page_id is gone (Peek 601, 11-20): name a row by its Peek id";
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

/** The business's Instagram or Facebook page: https on that site, a page path, nothing else. */
export function socialUrl(key: "instagram_url" | "facebook_url", s: string): { value: string } | { error: string } {
  const host = key === "instagram_url" ? /^(www\.)?instagram\.com$/ : /^(www\.|m\.)?facebook\.com$/;
  try {
    const u = new URL(s.trim());
    if (u.protocol === "https:" && host.test(u.hostname) && u.pathname.replace(/\/+$/, "").length > 1) return { value: `https://${u.hostname}${u.pathname.replace(/\/+$/, "")}` };
  } catch {
    /* not a URL */
  }
  return { error: `${key} is the business's own ${key === "instagram_url" ? "Instagram" : "Facebook"} page (https://${key === "instagram_url" ? "instagram" : "facebook"}.com/...)` };
}

/** A value as stored, or an error message. Empty text and empty lists are null. */
function normalise(f: Field, v: unknown): { value: unknown } | { error: string } {
  if (v === null || v === undefined || v === "") return { value: null };
  if (f.kind === "text") {
    if (typeof v !== "string" && typeof v !== "number") return { error: `${f.key} is text` };
    const s = String(v).trim();
    if (s.length > MAX_TEXT) return { error: `${f.key} is longer than ${MAX_TEXT} characters` };
    if (f.key === "phone") return { value: e164(s) || null };
    if (f.key === "sample_url") return isSampleUrl(s) ? { value: s } : { error: "sample_url is a link starting with https://" };
    if (f.key === "instagram_url" || f.key === "facebook_url") return socialUrl(f.key, s);
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
  const out: Lead = { id: r.id, rev: Number(r.rev) };
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
    site_facts: r.siteFacts ?? null, // the Enricher's site facts for the Site Builder
    followup_drafts: r.followupDrafts ?? null, // A draft per follow-up step
    // the bot's draft before a person rewrote it (read only; the training scripts pair it with the sent text)
    bot_draft: r.botDraft ?? null,
    bot_whatsapp: r.botWhatsapp ?? null,
  });
  return out;
}

/** toApi for a list read: the same keys, but only the cells in `keys` (the status, identity and dates always). */
function toApiPartial(r: typeof leads.$inferSelect, keys: Set<string>): Lead {
  const out: Lead = { id: r.id, rev: Number(r.rev) };
  for (const f of FIELDS) if (keys.has(f.key)) out[f.key] = r[f.prop] ?? null;
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
  });
  if (keys.has("site_facts") || keys.has("siteFacts")) out.site_facts = r.siteFacts ?? null;
  if (keys.has("followup_drafts")) out.followup_drafts = r.followupDrafts ?? null;
  if (keys.has("bot_draft")) out.bot_draft = r.botDraft ?? null;
  if (keys.has("bot_whatsapp")) out.bot_whatsapp = r.botWhatsapp ?? null;
  return out;
}

/** The board's newest change (its highest rev), for a list read's ETag: nothing new, nothing sent. */
export async function boardRev(db: Db, tenantId: string, board: "leads" | "tasks"): Promise<number> {
  const t = board === "leads" ? leads : tasks;
  const [r] = await db.select({ rev: sql<number>`coalesce(max(${t.rev}), 0)` }).from(t).where(eq(t.tenantId, tenantId));
  return Number(r?.rev ?? 0);
}

/**
 * Write one lead: an update to the row found by `target`, or, when there is none and `create` is set, a new row.
 * `input` holds fields under their Neon names (and Notion's `status` list, split here). Returns what was written and
 * what was refused, with the row as stored, from the same transaction.
 */
export async function writeLead(
  db: Db,
  tenantId: string,
  target: { id?: string },
  input: Record<string, unknown>,
  actor: Actor,
  // sentAt: when the send happened, for a send marked after the fact (Leads → Mark already sent); else now
  // pastSend: a send marked after the fact: the send log takes it only with a date the person gave
  opts: { create?: boolean; fillOnly?: boolean; import?: boolean; sourceUrl?: string | null; sentAt?: Date | null; pastSend?: boolean } = {},
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
  // the Enricher's site facts: one JSON object, replaced whole by each write (never fill_only), up to
  // 64 KB; null clears it
  let siteFacts: Record<string, unknown> | null | undefined;
  for (const k of ["siteFacts", "site_facts"]) {
    if (!(k in raw)) continue;
    const v = raw[k];
    delete raw[k];
    if (v !== null && (typeof v !== "object" || Array.isArray(v))) return { ok: false, code: "bad_request", message: "siteFacts is one JSON object" };
    if (v !== null && Buffer.byteLength(JSON.stringify(v)) > 64 * 1024) return { ok: false, code: "bad_request", message: "siteFacts is over 64 KB" };
    siteFacts = v as Record<string, unknown> | null;
  }
  // A draft per follow-up step, merged by step and stamped here (lib/follow-up-drafts.ts)
  let followupSteps: Map<StepKey, StepInput> | undefined;
  for (const k of ["followup_drafts", "followupDrafts"]) {
    if (!(k in raw)) continue;
    const r = readStepInput(raw[k]);
    delete raw[k];
    if (!r.ok) return { ok: false, code: "bad_request", message: r.message };
    followupSteps = r.steps;
  }
  const want = new Map<Field, unknown>();
  const derived = Object.keys(raw).filter((k) => DERIVED.includes(k));
  for (const [k, v] of Object.entries(raw)) {
    if (["id", "notion_page_id", "rev", "domain", "city", "state", "sent_at", "archived", "updated_at", "last_edited_by"].includes(k)) continue;
    if (k === "created_at") continue; // an import's created_at is read below
    const f = BY_KEY.get(k);
    if (!f) return { ok: false, code: "bad_request", message: `unknown field: ${k}` };
    const n = normalise(f, v);
    if ("error" in n) return { ok: false, code: "bad_request", message: n.error };
    want.set(f, n.value);
  }
  // An agent never sets found_by itself (Peek writes it on the agent's create, below): a value it sends is
  // dropped, not refused, so no caller breaks, and an agent's update cannot change it. A person's write and an import's keep it.
  if (actor.kind === "bot" && !opts.import) want.delete(BY_KEY.get("found_by")!);
  const createdAt = opts.import && typeof input.created_at === "string" && !Number.isNaN(Date.parse(input.created_at)) ? new Date(input.created_at) : null;
  // a late caller still naming rows by their Notion page id gets this, so it shows in the log (the column was dropped)
  if (typeof input.notion_page_id === "string" && input.notion_page_id.trim()) return { ok: false, code: "bad_request", message: NOTION_GONE };
  if (!target.id && !opts.create) return { ok: false, code: "bad_request", message: "a lead is named by its id" };
  if (target.id && !/^[0-9a-f-]{36}$/i.test(target.id)) return { ok: false, code: "not_found", message: `no lead ${target.id}` };
  const sourceUrl = opts.sourceUrl ? String(opts.sourceUrl).slice(0, 2000) : null;

  const res = await db.transaction(async (tx) => {
    const where = target.id ? eq(leads.id, target.id) : null;
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
      if (!opts.create) return { ok: false as const, code: "not_found" as const, message: `no lead ${target.id}` };
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
      // An agent's new lead names who found it, the writing agent's
      // display name (Lead Gen's creates arrive as "Lead Gen" on the engine key), always. The engine never sent it, so 452
      // rows since 11-08 had none. A person's create and an import's are unchanged.
      if (actor.kind === "bot" && !opts.import) values.foundBy = who.actorName;
      const firstDrafts = followupSteps ? mergeDrafts(null, followupSteps, actor.kind === "person" ? "person" : "bot", now) : null;
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
          domain,
          city: place?.city || null,
          state: place?.state || null,
          sentAt: values.emailStatus === "Email Sent" && !opts.import ? now : null,
          lastActorName: who.actorName,
          lastActorKind: who.actorKind,
          ...(createdAt ? { createdAt } : {}),
          ...(siteFacts ? { siteFacts } : {}),
          ...(firstDrafts?.written.length ? { followupDrafts: firstDrafts.next } : {}),
        })
        .returning();
      for (const f of FIELDS) if (values[f.prop] !== undefined) history.push({ tenantId, leadId: row.id, column: f.key, old: null, new: values[f.prop] as object, ...who });
      for (const r of refused) history.push({ tenantId, leadId: row.id, column: r.field, old: null, new: want.get(BY_KEY.get(r.field)!) as object, ...who, outcome: "refused", reason: r.reason });
      if (siteFacts) history.push({ tenantId, leadId: row.id, column: "site_facts", old: null, new: siteFacts as object, ...who });
      if (firstDrafts?.written.length) history.push({ tenantId, leadId: row.id, column: "followup_drafts", old: null, new: firstDrafts.next as object, ...who });
      if (history.length) await tx.insert(leadCells).values(history);
      return { ok: true as const, created: true, lead: toApi(row), written: [...Object.keys(values).map((p) => FIELDS.find((f) => f.prop === p)!.key), ...(siteFacts ? ["site_facts"] : []), ...(firstDrafts?.written.length ? ["followup_drafts"] : [])], refused };
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
    // Research first: a bot's pain point or draft on a lead still waiting for a person's research is refused
    const listed = actor.kind === "bot" && !opts.import && [...want.keys()].some((f) => FENCED.has(f.key)) && (await isListed(tx as unknown as Db, tenantId, cur.id));
    const set: Record<string, unknown> = {};
    const written: string[] = [];
    for (const [f, v] of want) {
      const old = cur[f.prop] ?? null;
      if (same(old, v)) continue;
      let reason: Refusal["reason"] | null = null;
      if (!opts.import && !validatorClears(actor, f.key, old, v)) {
        if (actor.kind === "bot" && f.human) reason = "human_only";
        else if (listed && FENCED.has(f.key)) reason = "research_first";
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
    if (siteFacts !== undefined && !same(cur.siteFacts, siteFacts)) {
      set.siteFacts = siteFacts;
      written.push("site_facts");
      history.push({ tenantId, leadId: cur.id, column: "site_facts", old: (cur.siteFacts ?? null) as object, new: siteFacts as object, ...who });
    }
    if (followupSteps) {
      const m = mergeDrafts(cur.followupDrafts, followupSteps, actor.kind === "person" ? "person" : "bot", now);
      for (const k of m.refused) {
        const field = `followup_drafts.${k}`;
        refused.push({ field, reason: "person_wins", current: cur.followupDrafts?.[k] ?? null });
        history.push({ tenantId, leadId: cur.id, column: field, old: (cur.followupDrafts?.[k] ?? null) as object, new: followupSteps.get(k) as object, ...who, outcome: "refused", reason: "person_wins" });
      }
      if (m.written.length) {
        set.followupDrafts = m.next;
        written.push("followup_drafts");
        history.push({ tenantId, leadId: cur.id, column: "followup_drafts", old: (cur.followupDrafts ?? null) as object, new: m.next as object, ...who });
      }
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
    // A WhatsApp message sent is a send too: it fills Sent by and Sent at as Email Sent does, when
    // they are empty; the × on its chip clears them with it (clearStatus: the companions written in the same step).
    if ((set.emailStatus === "Email Sent" || set.whatsappStatus === WHATSAPP_SENT) && !cur.sentAt && !opts.import) {
      const sentAt = opts.sentAt && opts.sentAt.getTime() <= now.getTime() ? opts.sentAt : now;
      set.sentAt = sentAt;
      history.push({ tenantId, leadId: cur.id, column: "sent_at", old: null, new: sentAt.toISOString() as unknown as object, ...who });
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
  if (res.ok && derived.length && !opts.import)
    for (const k of derived) res.refused.push({ field: k, reason: "derived", current: (res.lead as Record<string, unknown>)[k] ?? null });
  // The send log follows the board, after the commit; it never throws, so it can never fail this write
  if (res.ok && !opts.import && res.written.some((k) => ["email_status", "whatsapp_status", "result", "sample_url"].includes(k)))
    await syncLeadSends(db, tenantId, String(res.lead.id), { sent: { email: res.written.includes("email_status"), whatsapp: res.written.includes("whatsapp_status") }, sentAt: opts.sentAt, past: opts.pastSend });
  // the lead's sample, after the commit: frozen at Replied or Meeting, re-rendered on a facts change
  if (res.ok && !res.created && res.written.length) await onLeadWrite(db, tenantId, String(res.lead.id), res.written, (res.lead.result as string | null) ?? null, { import: opts.import });
  // A send closes the hold on the lead, by whatever path it was marked; never fails the write
  if (res.ok && (res.written.includes("email_status") && res.lead.email_status === "Email Sent" || res.written.includes("whatsapp_status") && res.lead.whatsapp_status === WHATSAPP_SENT))
    await closeClaim(db, tenantId, String(res.lead.id)).catch((err) => console.error("leads.closeClaim", err instanceof Error ? err.message : err));
  // a person's write shows on their next view: the board's held fingerprint goes (lib/board-fp.ts; bots wait up to a minute)
  if (res.ok && actor.kind === "person") dropFingerprint(tenantId);
  return res;
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
/** The long cells a list read leaves out unless asked for (to save egress): drafts, pain point, evidence,
 *  the listing, notes, the bot's kept drafts. A lead's own read (GET /v1/rows/<id>) always has every cell. */
export const LONG_FIELDS = ["draft_email", "draft_whatsapp", "draft_followup", "pain_point", "evidence", "listing_evidence", "source_pages", "site_health", "notes", "listing", "bot_draft", "bot_whatsapp", "followup_drafts"] as const;
const LIST_EXTRA = ["bot_draft", "bot_whatsapp", "followup_drafts"] as const;
/** The cells a list read answers: ?fields=a,b (any of the board's keys, plus bot_draft and bot_whatsapp), "slim" (all
 *  but LONG_FIELDS), "all"; none given: the default, "all" until PEEK_SLIM_DEFAULT=1 is set (the readers ask for
 *  their long cells first, so no bot takes a missing draft for an empty one). Unknown names are refused. */
export function fieldsOf(param: string | null | undefined, slimDefault = process.env.PEEK_SLIM_DEFAULT === "1"): { ok: true; keys: Set<string> } | { ok: false; message: string } {
  const every = [...FIELDS.map((f) => f.key), ...LIST_EXTRA];
  const v = (param ?? "").trim();
  if (!v) return { ok: true, keys: new Set(slimDefault ? every.filter((k) => !(LONG_FIELDS as readonly string[]).includes(k)) : every) };
  if (v === "all") return { ok: true, keys: new Set(every) };
  if (v === "slim") return { ok: true, keys: new Set(every.filter((k) => !(LONG_FIELDS as readonly string[]).includes(k))) };
  const asked = v.split(",").map((s) => s.trim()).filter(Boolean);
  const bad = asked.filter((k) => !every.includes(k));
  if (bad.length) return { ok: false, message: `unknown field: ${bad.join(", ")}` };
  return { ok: true, keys: new Set(asked) };
}

export async function listLeads(db: Db, tenantId: string, q: LeadQuery = {}, keys?: Set<string>) {
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
  // Only the columns asked for travel (no select *): the row's identity and status always, the cells by `keys`.
  const want = keys ?? new Set([...FIELDS.map((f) => f.key), ...LIST_EXTRA]);
  const cols: Record<string, unknown> = { id: leads.id, rev: leads.rev, domain: leads.domain, city: leads.city, state: leads.state, sentAt: leads.sentAt, archived: leads.archived, createdAt: leads.createdAt, updatedAt: leads.updatedAt, lastActorName: leads.lastActorName, lastActorKind: leads.lastActorKind, emailStatus: leads.emailStatus, whatsappStatus: leads.whatsappStatus };
  for (const f of FIELDS) if (want.has(f.key)) cols[f.prop] = leads[f.prop as keyof typeof leads.$inferSelect & keyof typeof leads];
  if (want.has("bot_draft")) cols.botDraft = leads.botDraft;
  if (want.has("bot_whatsapp")) cols.botWhatsapp = leads.botWhatsapp;
  const rows = (await db
    .select(cols as never)
    .from(leads)
    .where(and(...where))
    .orderBy(asc(leads.rev))
    .limit(limit + 1)) as unknown as (typeof leads.$inferSelect)[];
  const page = rows.slice(0, limit);
  return { leads: page.map((r) => toApiPartial(r, want)), next: page.length ? Number(page[page.length - 1].rev) : since, more: rows.length > limit };
}

export async function getLead(db: Db, tenantId: string, target: { id?: string }) {
  if (!target.id || !/^[0-9a-f-]{36}$/i.test(target.id)) return null;
  const [r] = await db.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, target.id)));
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

/** For the Table tab (a table view, like Notion's): the board's columns and every other
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
    toolsOnSite: leads.toolsOnSite, // the Tools on site filter, on the Board tab too
    emailStatus: leads.emailStatus,
    whatsappStatus: leads.whatsappStatus,
    result: leads.result,
    sentBy: leads.sentBy,
    hasDraft: sql<boolean>`${leads.draftEmail} is not null and ${leads.draftEmail} not ilike 'skip:%'`,
    hasWhatsapp: sql<boolean>`coalesce(trim(${leads.whatsapp}), '') <> ''`,
    updatedAt: leads.updatedAt,
    takenBy: sql<string | null>`(select coalesce(nullif(trim(u.name), ''), split_part(u.email, '@', 1)) from ${claims} c join ${users} u on u.id = c.user_id where c.tenant_id = "leads"."tenant_id" and c.page_id = "leads"."id"::text)`,
    mine: sql<boolean>`exists (select 1 from ${claims} c where c.tenant_id = "leads"."tenant_id" and c.page_id = "leads"."id"::text and c.user_id = ${userId})
      or exists (select 1 from ${leadCells} m where m.lead_id = "leads"."id" and m.actor_user_id = ${userId} and m.outcome = 'applied')`,
    openFlags: sql<number>`(select count(*)::int from ${leadFlags} f where f.lead_id = "leads"."id" and f.status = 'open')`,
    corrected: sql<boolean>`exists (select 1 from ${leadCells} p where p.lead_id = "leads"."id" and p.actor_kind = 'person' and p.outcome = 'applied'
      and exists (select 1 from ${leadCells} b where b.lead_id = p.lead_id and b."column" = p."column" and b.actor_kind = 'bot' and b.outcome = 'applied' and b.id < p.id))`,
  };
}


/** Clear, in a status line's menu (in place of undo): empty that status cell, and with it the cells the same
 *  step set (sent by, sent at, result, result date), when they still hold what that step wrote. One history entry by
 *  the person ("cleared"). Answers what was cleared; nothing when the status is already empty. */
export const CLEARABLE = ["email_status", "whatsapp_status", "result"] as const;
const COMPANIONS = ["sent_by", "sent_at", "result", "result_date", "email_status"];

export async function clearStatus(db: Db, tenantId: string, leadId: string, field: (typeof CLEARABLE)[number], actor: Extract<Actor, { kind: "person" }>) {
  if (!CLEARABLE.includes(field) || !/^[0-9a-f-]{36}$/i.test(leadId)) return { ok: false as const, error: "Nothing to clear." };
  const out = await db.transaction(async (tx) => {
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
  if (out.ok) await syncLeadSends(db, tenantId, leadId); // A cleared send or result leaves the log too
  if (out.ok) dropFingerprint(tenantId); // a person's clear shows at once (lib/board-fp.ts)
  return out;
}

/** What to ask a person before saving these fields on this lead (lib/pain-point-check.ts saveWarning,
 *  against the board's other live leads' names), or "". */
export async function leadSaveWarning(db: Db, tenantId: string, leadId: string, fields: Record<string, unknown>): Promise<string> {
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return "";
  const rows = await db.select({ id: leads.id, business: leads.business, industry: leads.industry }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.archived, false)));
  const own = rows.find((r) => r.id === leadId);
  if (!own) return "";
  // the row's own trade is never another business (as the Validator passes ld.industry)
  return saveWarning(fields, own.business.split(" | ")[0], rows.filter((r) => r.id !== leadId).map((r) => r.business.split(" | ")[0]), own.industry ? [own.industry] : []);
}

