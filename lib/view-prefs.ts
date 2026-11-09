// A person's own view of the lead drawer: whether empty fields show, the
// order of the fields, and the ones kept behind an "n hidden" line. Kept on the person (users.view_prefs) so it follows
// them to any browser; Settings → My view writes it and the drawer reads it (the database side: lib/view-prefs-db.ts;
// this file stays pure, so the drawer may import it). Unknown keys are dropped and fields added since go at the end in
// the default order, so a saved view never hides a new field by accident.
import { DRAWER_ORDER } from "./lead-workflow";

export type ViewPrefs = { show_empty: boolean; field_order: string[]; hidden_fields: string[] };
export const DEFAULT_VIEW: ViewPrefs = { show_empty: true, field_order: [], hidden_fields: [] };

const known = new Set(DRAWER_ORDER);
const keysOf = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((k): k is string => typeof k === "string" && known.has(k)))] : []);

/** Whatever is stored (or sent) as a tidy view: booleans and known field keys only, an order of default fields cleared. */
export function viewOf(raw: unknown): ViewPrefs {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const order = keysOf(r.field_order);
  return {
    show_empty: typeof r.show_empty === "boolean" ? r.show_empty : true,
    // the default order is stored as no order, so fields added later fall into their default place
    field_order: order.join() === DRAWER_ORDER.slice(0, order.length).join() ? [] : order,
    hidden_fields: keysOf(r.hidden_fields),
  };
}

/** Every drawer field in the person's order: theirs first, then the rest in the default order. */
export function drawerOrder(v: ViewPrefs): string[] {
  const mine = v.field_order.filter((k) => known.has(k));
  return [...mine, ...DRAWER_ORDER.filter((k) => !mine.includes(k))];
}

/** The Table tab's column keys (leadScore, foundBy) as drawer fields (lead_score, found_by), in the table's order; the
 *  columns the drawer has no row for (the header's business, website, location, industry) are skipped. */
export function orderFromTable(columnKeys: string[]): string[] {
  const snake = columnKeys.map((k) => k.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`));
  return [...new Set(snake.filter((k) => known.has(k)))];
}

/** The fields' names as the drawer and My view show them. */
export const FIELD_LABELS: Record<string, string> = {
  business: "Business",
  website: "Website",
  business_email: "Business email",
  email_check: "Email check",
  location: "Location",
  industry: "Industry",
  size: "Company size",
  contact_person: "Contact person",
  contact_role: "Contact role",
  founder_linkedin: "Founder LinkedIn",
  linkedin_via: "LinkedIn found via",
  whatsapp: "WhatsApp",
  map_link: "Map",
  pain_point: "Pain point",
  package: "How can I help",
  evidence: "Evidence",
  listing_evidence: "Google listing",
  source_pages: "Source pages",
  tools_on_site: "Tools on site",
  site_health: "Site health",
  lead_score: "Lead score",
  draft_email: "Draft email",
  draft_whatsapp: "Draft WhatsApp message",
  draft_followup: "Draft follow-up",
  email_status: "Email status",
  whatsapp_status: "WhatsApp status",
  result: "Result",
  result_date: "Result date",
  sent_by: "Sent by",
  sent_at: "Sent at",
  follow_up_at: "Follow-up sent",
  follow_up_by: "Follow-up by",
  found_by: "Found by",
  phone: "Phone",
  notes: "Notes",
  notion_uid: "Notion ID",
  created_at: "Created",
};
export const fieldLabel = (k: string) => FIELD_LABELS[k] ?? k;
