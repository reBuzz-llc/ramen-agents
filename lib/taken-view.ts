// One person's Taken page: the leads they hold and the ones they sent this week, side by side
// with each lead's changes. Every person's change on the lead shows, named (a teammate may edit a lead someone else holds);
// the agents' changes are kept for a "show agents' changes too" switch. Read from the lead's history (lead_cells).
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Db } from "./db";
import { leadCells, leads } from "./db/schema";
import { takenLeads } from "./claims";
import { scoreFacts } from "./lead-queue";
import { personNamed, type Person } from "./scoreboard";
import { fieldLabel } from "./view-prefs";

export type TakenChange = { id: number; field: string; before: string; after: string; long: boolean; who: string; person: boolean; other: boolean; at: string; when: string; today: boolean };
export type TakenItem = { id: string; business: string; where: string; industry: string; kind: "Email" | "WhatsApp"; sent: boolean; at: string; when: string; changes: TakenChange[] };
export type TakenSummary = { held: number; sent: number; changedToday: number; bySomeoneElse: number };

const LONG = 80;

/** A history value as text: a list joined, nothing as "". */
export function valueText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(valueText).filter(Boolean).join(", ");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v).trim();
}

const dayOf = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
/** "Mon 16:40" this week, "Nov 12 16:40" before. */
export function whenText(d: Date, now: Date): string {
  const hm = d.toTimeString().slice(0, 5);
  const days = (now.getTime() - d.getTime()) / 86400e3;
  return days < 6 ? `${d.toLocaleDateString("en-US", { weekday: "short" })} ${hm}` : `${d.toLocaleDateString("en-US", { month: "short", day: "numeric" })} ${hm}`;
}

/** The page's line across the top: held, sent this week, leads a person changed today, leads someone else changed. */
export function summaryOf(items: TakenItem[]): TakenSummary {
  return {
    held: items.filter((i) => !i.sent).length,
    sent: items.filter((i) => i.sent).length,
    changedToday: items.filter((i) => i.changes.some((c) => c.person && c.today)).length,
    bySomeoneElse: items.filter((i) => i.changes.some((c) => c.person && c.other)).length,
  };
}

/** The leads `person` holds now (oldest take first) and the ones they sent since `from` (newest first), each with its
 *  history, oldest change first. */
export async function takenView(db: Db, tenantId: string, person: Person, people: Person[], from: Date, now = new Date()): Promise<TakenItem[]> {
  const [held, facts] = await Promise.all([takenLeads(db, tenantId, person.id), scoreFacts(db, tenantId, from).then((f) => f.leads, () => [])]);
  // sent this week by this person, as This week counts them: an email by Sent by, a WhatsApp message by who pressed it
  const sentAt = new Map<string, { at: Date; kind: "Email" | "WhatsApp" }>();
  for (const l of facts) {
    const email = l.emailStatus === "Email Sent" && l.sentAt && l.sentAt >= from && l.sentBy.some((n) => personNamed(people, n)?.id === person.id);
    const wa = l.whatsappStatus === "WhatsApp msg sent" && l.waSentBy === person.id && l.waSentAt && l.waSentAt >= from;
    if (wa) sentAt.set(l.id, { at: l.waSentAt!, kind: "WhatsApp" });
    else if (email) sentAt.set(l.id, { at: l.sentAt!, kind: "Email" });
  }
  const heldIds = new Set(held.map((h) => h.id));
  const sentIds = [...sentAt.keys()].filter((id) => !heldIds.has(id));
  const ids = [...heldIds, ...sentIds];
  if (!ids.length) return [];
  const [sentRows, history] = await Promise.all([
    sentIds.length ? db.select({ id: leads.id, business: leads.business, city: leads.city, state: leads.state, industry: leads.industry }).from(leads).where(and(eq(leads.tenantId, tenantId), inArray(leads.id, sentIds))) : Promise.resolve([]),
    db
      .select({ id: leadCells.id, leadId: leadCells.leadId, column: leadCells.column, old: leadCells.old, new: leadCells.new, kind: leadCells.actorKind, name: leadCells.actorName, userId: leadCells.actorUserId, at: leadCells.at })
      .from(leadCells)
      .where(and(eq(leadCells.tenantId, tenantId), inArray(leadCells.leadId, ids), eq(leadCells.outcome, "applied")))
      .orderBy(asc(leadCells.id)),
  ]);
  const today = dayOf(now);
  const byLead = new Map<string, TakenChange[]>();
  for (const h of history) {
    const before = valueText(h.old);
    const after = valueText(h.new);
    if (before === after) continue;
    const isPerson = h.kind === "person";
    const at = new Date(h.at);
    const list = byLead.get(h.leadId) ?? [];
    list.push({
      id: Number(h.id),
      field: fieldLabel(h.column),
      before,
      after,
      long: before.length > LONG || after.length > LONG || /\n/.test(before + after),
      who: h.name,
      person: isPerson,
      other: isPerson && h.userId !== person.id,
      at: at.toISOString(),
      when: whenText(at, now),
      today: dayOf(at) === today,
    });
    byLead.set(h.leadId, list);
  }
  const where = (city: string | null, state: string | null) => [city, state].filter(Boolean).join(", ");
  const items: TakenItem[] = held.map((h) => ({ id: h.id, business: h.business, where: where(h.city, h.state), industry: h.industry ?? "", kind: h.kind === "whatsapp" ? "WhatsApp" : "Email", sent: false, at: h.at.toISOString(), when: whenText(h.at, now), changes: byLead.get(h.id) ?? [] }));
  const sent = sentRows
    .map((r) => ({ r, s: sentAt.get(r.id)! }))
    .sort((a, b) => b.s.at.getTime() - a.s.at.getTime())
    .map(({ r, s }): TakenItem => ({ id: r.id, business: r.business, where: where(r.city, r.state), industry: r.industry ?? "", kind: s.kind, sent: true, at: s.at.toISOString(), when: whenText(s.at, now), changes: byLead.get(r.id) ?? [] }));
  return [...items, ...sent];
}
