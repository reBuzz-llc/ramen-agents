// A person's rewrite of a Writer draft as its group's template (the record and
// rules agreed with the Validator, lib/template-rules.ts). After a person saves a draft that is more than a small fix,
// Peek asks once: use it for the other N leads of its group? Yes or "just this lead" is stored here (opened_by "peek",
// decided there); a save nobody answers is left to the Validator's sweep, which opens a proposal for the owner's
// Decisions box. The first answer wins: a decided proposal is never changed again (409 with the record). Approving one
// replaces the group's earlier approved template for that channel.
import { and, desc, eq, gte, inArray, isNull, ne, or, sql } from "drizzle-orm";
import type { Db } from "./db";
import { leadCells, leads, templateProposals } from "./db/schema";
import { WHATSAPP_SENT } from "./leads";
import { groupOf, groupWords, isSmallFix, makeTemplate, textKey, type RuleRow } from "./template-rules";

export type Channel = "email" | "whatsapp";
export const CHANNEL_OF: Record<string, Channel> = { draft_email: "email", draft_whatsapp: "whatsapp" };
const COLUMN: Record<Channel, "draftEmail" | "draftWhatsapp"> = { email: "draftEmail", whatsapp: "draftWhatsapp" };
const BOT: Record<Channel, "botDraft" | "botWhatsapp"> = { email: "botDraft", whatsapp: "botWhatsapp" };
export const STATUSES = ["open", "approved", "declined", "one_off", "replaced"] as const;
export type Status = (typeof STATUSES)[number];
type Row = typeof templateProposals.$inferSelect;

/** The wire form (the agreed field names). */
export const wire = (r: Row) => ({
  id: r.id, group: r.group, channel: r.channel, lead_id: r.leadId, lead_name: r.leadName, edit_id: r.editId, edited_by: r.editedBy,
  edited_at: r.editedAt.toISOString(), before: r.before, after: r.after, template: r.template, placeholders: r.placeholders,
  failed_rules: r.failedRules, checked: r.checked, count: r.count, text_key: r.textKey, status: r.status, decided_by: r.decidedBy,
  decided_where: r.decidedWhere, decided_at: r.decidedAt?.toISOString() ?? null, opened_by: r.openedBy, updated_at: r.updatedAt.toISOString(),
  // the earlier texts when the template was uplifted; uplifted_at / uplifted_by from the newest one
  template_history: r.templateHistory, uplifted_at: r.templateHistory.at(-1)?.at ?? null, uplifted_by: r.templateHistory.at(-1)?.by ?? null,
});

const ruleRow = (l: typeof leads.$inferSelect): RuleRow => ({ business: l.business.split(" | ")[0], contact: l.contactPerson, city: l.city, website: l.website, package: l.package, pain_point: l.painPoint });

/** Pure: the proposal id, "tpl-<group>-<channel>-<yyyymmddHHMM>-<edit id>" (the group in lower-case words joined by dashes). */
export function proposalId(group: string, channel: Channel, at: Date, editId: number): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}${p(at.getUTCHours())}${p(at.getUTCMinutes())}`;
  return `tpl-${group.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${channel}-${stamp}-${editId}`;
}

/** The other leads of a group that a template would reach: the same group, a draft for the channel that no person has
 *  rewritten (no snapshot of the Writer's text beside it, lib/leads.ts BOT_SNAPSHOT), and not sent on that channel. */
export async function groupCount(d: Db, tenantId: string, group: string, channel: Channel, exceptLead: string): Promise<number> {
  const col = leads[COLUMN[channel]], bot = leads[BOT[channel]];
  const inGroup = group.startsWith("no package, ")
    ? and(or(isNull(leads.package), eq(leads.package, "")), group.endsWith("own website") ? sql`coalesce(${leads.website}, '') <> ''` : sql`coalesce(${leads.website}, '') = ''`)
    : eq(leads.package, group);
  const unsent = channel === "email" ? sql`coalesce(${leads.emailStatus}, '') not like '%Email Sent%'` : sql`coalesce(${leads.whatsappStatus}, '') not like ${`%${WHATSAPP_SENT}%`}`;
  const [r] = await d.select({ n: sql<number>`count(*)::int` }).from(leads)
    .where(and(eq(leads.tenantId, tenantId), ne(leads.id, exceptLead), inGroup, sql`coalesce(${col}, '') <> ''`, isNull(bot), unsent));
  return r?.n ?? 0;
}

export type Offer = { edit_id: number; channel: Channel; group: string; count: number; words: string };

/** After a person's save: the prompt to show, or null. Only for that person's own applied save of a draft, more than a
 *  small fix of the Writer's draft, a text not declined or kept one-off before, an edit not answered yet, and a group with
 *  other leads to reach. */
export async function offerFor(d: Db, tenantId: string, leadId: string, editId: number, userId: string): Promise<Offer | null> {
  const [cell] = await d.select().from(leadCells).where(and(eq(leadCells.tenantId, tenantId), eq(leadCells.leadId, leadId), eq(leadCells.id, editId)));
  const channel = cell && CHANNEL_OF[cell.column];
  if (!cell || !channel || cell.actorKind !== "person" || cell.actorUserId !== userId || cell.outcome !== "applied") return null;
  const [lead] = await d.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
  const after = typeof cell.new === "string" ? cell.new : "";
  const before = lead?.[BOT[channel]] ?? "";
  if (!lead || !after.trim() || !before.trim() || isSmallFix(before, after, ruleRow(lead))) return null;
  const key = textKey(after);
  const seen = await d.select({ id: templateProposals.id }).from(templateProposals).where(and(eq(templateProposals.tenantId, tenantId),
    or(and(eq(templateProposals.leadId, leadId), eq(templateProposals.channel, channel), eq(templateProposals.editId, editId)), and(eq(templateProposals.textKey, key), inArray(templateProposals.status, ["declined", "one_off"])))));
  if (seen.length) return null;
  const group = groupOf(ruleRow(lead));
  const count = await groupCount(d, tenantId, group, channel, leadId);
  return count ? { edit_id: editId, channel, group, count, words: groupWords(group, count) } : null;
}

export class ProposalError extends Error {
  constructor(public status: number, message: string, public current?: ReturnType<typeof wire>) {
    super(message);
  }
}

/** Approving a template for a group and channel replaces the one approved before. */
async function replaceOthers(d: Db, tenantId: string, keep: Row) {
  await d.update(templateProposals).set({ status: "replaced", updatedAt: new Date() })
    .where(and(eq(templateProposals.tenantId, tenantId), eq(templateProposals.group, keep.group), eq(templateProposals.channel, keep.channel), eq(templateProposals.status, "approved"), ne(templateProposals.id, keep.id)));
}

/** The record for an edit, built from the save itself (the Writer's draft before, the person's text after). */
async function recordFor(d: Db, tenantId: string, leadId: string, editId: number) {
  const [cell] = await d.select().from(leadCells).where(and(eq(leadCells.tenantId, tenantId), eq(leadCells.leadId, leadId), eq(leadCells.id, editId)));
  const channel = cell && CHANNEL_OF[cell.column];
  if (!cell || !channel) throw new ProposalError(404, "no draft save with that edit id on that lead");
  const [lead] = await d.select().from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
  if (!lead) throw new ProposalError(404, "no such lead");
  const after = typeof cell.new === "string" ? cell.new : "";
  const row = ruleRow(lead);
  const group = groupOf(row);
  const [template, placeholders] = makeTemplate(after, row);
  return {
    id: proposalId(group, channel, cell.at, editId), tenantId, group, channel, leadId, leadName: row.business ?? "", editId, editedBy: cell.actorName,
    editedAt: cell.at, before: lead[BOT[channel]] ?? "", after, template, placeholders, textKey: textKey(after),
    count: await groupCount(d, tenantId, group, channel, leadId),
  };
}

/** A person's answer to Peek's prompt: Yes approves it as the group's template, "just this lead" keeps it one-off. */
export async function answerOnPeek(d: Db, tenantId: string, leadId: string, editId: number, yes: boolean, by: string): Promise<ReturnType<typeof wire>> {
  const rec = await recordFor(d, tenantId, leadId, editId);
  const now = new Date();
  const [row] = await d.insert(templateProposals).values({ ...rec, status: yes ? "approved" : "one_off", decidedBy: by, decidedWhere: "peek", decidedAt: now, openedBy: "peek" })
    .onConflictDoNothing().returning();
  if (!row) {
    const [cur] = await d.select().from(templateProposals).where(and(eq(templateProposals.tenantId, tenantId), eq(templateProposals.leadId, leadId), eq(templateProposals.channel, rec.channel), eq(templateProposals.editId, editId)));
    throw new ProposalError(409, "this edit already has an answer", cur ? wire(cur) : undefined);
  }
  if (yes) await replaceOthers(d, tenantId, row);
  return wire(row);
}

/** The Validator's list: a status (or all) and changed since a time, newest first. */
export async function listProposals(d: Db, tenantId: string, o: { status?: string; since?: Date } = {}) {
  const where = [eq(templateProposals.tenantId, tenantId)];
  if (o.status) where.push(eq(templateProposals.status, o.status));
  if (o.since) where.push(gte(templateProposals.updatedAt, o.since));
  return (await d.select().from(templateProposals).where(and(...where)).orderBy(desc(templateProposals.updatedAt)).limit(500)).map(wire);
}

/** The Validator opens a proposal for an edit nobody answered on Peek (status open; refused when that edit has one, or
 *  when its text was declined or kept one-off before). */
export async function openProposal(d: Db, tenantId: string, leadId: string, editId: number): Promise<ReturnType<typeof wire>> {
  const rec = await recordFor(d, tenantId, leadId, editId);
  const [gone] = await d.select({ id: templateProposals.id }).from(templateProposals)
    .where(and(eq(templateProposals.tenantId, tenantId), eq(templateProposals.textKey, rec.textKey), inArray(templateProposals.status, ["declined", "one_off"])));
  if (gone) throw new ProposalError(409, `this text was answered before (${gone.id}): it is not proposed again`);
  const [row] = await d.insert(templateProposals).values({ ...rec, status: "open", openedBy: "validator" }).onConflictDoNothing().returning();
  if (!row) {
    const [cur] = await d.select().from(templateProposals).where(and(eq(templateProposals.tenantId, tenantId), eq(templateProposals.leadId, leadId), eq(templateProposals.channel, rec.channel), eq(templateProposals.editId, editId)));
    throw new ProposalError(409, "this edit already has a proposal", cur ? wire(cur) : undefined);
  }
  return wire(row);
}

export type Patch = {
  status?: unknown; decided_by?: unknown; decided_where?: unknown; failed_rules?: unknown; checked?: unknown; count?: unknown;
  template?: unknown; placeholders?: unknown; by?: unknown;
};
/** The key a change comes through: its name, and whether it is the Validator's (scope board:validate). */
export type Patcher = { key: string; validator: boolean };
export const TEMPLATE_MAX = 6000;

/** The Validator's change: its checks (failed_rules, checked), the refreshed count, or the owner's answer from the
 *  Decisions box (status, decided_by, decided_where). A status is set only while the proposal is open: else 409.
 *  Through the Validator's key alone, while the proposal is open, the template's text may be uplifted
 *  (template, placeholders, and an optional label `by` of who wrote it): the earlier text goes onto template_history.
 *  A new text and an answer never come in the same call. */
export async function patchProposal(d: Db, tenantId: string, id: string, p: Patch, via: Patcher = { key: "", validator: false }): Promise<ReturnType<typeof wire>> {
  const [cur] = await d.select().from(templateProposals).where(and(eq(templateProposals.tenantId, tenantId), eq(templateProposals.id, id)));
  if (!cur) throw new ProposalError(404, "no such proposal");
  const set: Partial<Row> = { updatedAt: new Date() };
  if (p.template !== undefined || p.placeholders !== undefined || p.by !== undefined) {
    if (!via.validator) throw new ProposalError(403, "only the Validator's key may change a proposal's text");
    if (p.status !== undefined) throw new ProposalError(400, "change the text and answer in separate calls");
    if (p.template === undefined) throw new ProposalError(400, "send the new template");
    if (cur.status !== "open") throw new ProposalError(409, `already ${cur.status}: its text no longer changes`, wire(cur));
    const text = typeof p.template === "string" ? p.template.replace(/\r\n?/g, "\n").trim() : "";
    if (!text || text.length > TEMPLATE_MAX) throw new ProposalError(400, `template is a text of 1 to ${TEMPLATE_MAX} characters`);
    const holes = p.placeholders === undefined ? cur.placeholders : p.placeholders;
    if (!Array.isArray(holes) || holes.length > 20 || !holes.every((h) => typeof h === "string" && h.trim() !== "" && h.length <= 60)) throw new ProposalError(400, "placeholders is a list of short texts");
    const missing = (holes as string[]).filter((h) => !text.includes(h));
    if (missing.length) throw new ProposalError(400, `the template does not carry ${missing.join(", ")}`);
    if (p.by !== undefined && typeof p.by !== "string") throw new ProposalError(400, "by is a short label");
    if (text !== cur.template || JSON.stringify(holes) !== JSON.stringify(cur.placeholders)) {
      set.template = text;
      set.placeholders = holes as string[];
      const label = typeof p.by === "string" ? p.by.replace(/\s+/g, " ").trim().slice(0, 80) : "";
      set.templateHistory = [...cur.templateHistory, { template: cur.template, placeholders: cur.placeholders, at: new Date().toISOString(), by: label, via: via.key }];
    }
  }
  if (p.failed_rules !== undefined) {
    if (!Array.isArray(p.failed_rules) || !p.failed_rules.every((r) => r && typeof r.rule === "string" && typeof r.detail === "string")) throw new ProposalError(400, "failed_rules is a list of {rule, detail}");
    set.failedRules = (p.failed_rules as { rule: string; detail: string }[]).map((r) => ({ rule: r.rule.slice(0, 40), detail: r.detail.slice(0, 300) }));
  }
  if (p.checked !== undefined) set.checked = p.checked === true;
  if (p.count !== undefined) {
    if (!Number.isInteger(p.count) || (p.count as number) < 0) throw new ProposalError(400, "count is a whole number");
    set.count = p.count as number;
  }
  if (p.status !== undefined) {
    if (!STATUSES.includes(p.status as Status) || p.status === "open") throw new ProposalError(400, `status is one of ${STATUSES.filter((s) => s !== "open").join(", ")}`);
    if (cur.status !== "open") throw new ProposalError(409, `already ${cur.status}`, wire(cur));
    set.status = p.status as Status;
    set.decidedBy = typeof p.decided_by === "string" ? p.decided_by.slice(0, 80) : "the owner";
    set.decidedWhere = p.decided_where === "peek" ? "peek" : "decisions_box";
    set.decidedAt = new Date();
  }
  const [row] = await d.update(templateProposals).set(set)
    .where(and(eq(templateProposals.tenantId, tenantId), eq(templateProposals.id, id), set.status || set.template !== undefined ? eq(templateProposals.status, "open") : sql`true`)).returning();
  if (!row) {
    const [now] = await d.select().from(templateProposals).where(eq(templateProposals.id, id));
    throw new ProposalError(409, `already ${now?.status ?? "decided"}`, now ? wire(now) : undefined);
  }
  if (row.status === "approved") await replaceOthers(d, tenantId, row);
  return wire(row);
}

