// A lead's status workflow on the board: the one-click steps a person takes, with the fields each writes. Email: New → Ready to Send →
// Email Sent → Replied / Meeting / Won / Lost (or Bounced). WhatsApp: Waiting for verification → Verified or False
// number → message sent. The values are the board's own (Notion's options, kept exactly). Sent by and sent at are filled
// by lib/leads.ts from the signed-in person when the email status becomes Email Sent. Pure, for the tests.

/** Notion's one Status column held two tracks; here each has its field. */
export const EMAIL_STATUSES = ["Ready to Send Email", "Email Sent"];
export const WHATSAPP_STATUSES = ["WhatsApp msg sent", "False Whatsapp Number", "WhatsApp Verified", "Waiting response for WhatsApp verification"];
export const RESULTS = ["Not contacted", "Emailed", "Replied", "Meeting", "Client", "Not interested", "Bounced"];
export const CONTACT_ROLES = [
  "Founder",
  "Owner",
  "CEO / President",
  "Principal / Partner",
  "General Manager",
  "Practice / Office Manager",
  "Operations",
  "Marketing",
  "Franchise Development",
  "Executive Director",
  "Other",
];
export const LINKEDIN_VIA = ["1 Own site", "2 Business listing", "3 Press article", "4 Search result"];

export type Step = { key: string; label: string; fields: Record<string, unknown>; tone: "go" | "good" | "bad" | "plain" };
type Lead = Record<string, unknown>; // email_status, whatsapp_status, result, whatsapp: a lead as the API answers it

const day = (now: Date) => now.toISOString().slice(0, 10);
const closed = (r: unknown) => r === "Client" || r === "Not interested" || r === "Bounced";

/** The next steps for a lead's email track, in the order shown. */
export function emailSteps(l: Lead, now = new Date()): Step[] {
  const result = (r: string, label: string, tone: Step["tone"]): Step => ({ key: `result:${r}`, label, fields: { result: r, result_date: day(now) }, tone });
  if (closed(l.result)) return [];
  if (!l.email_status) return [{ key: "email:ready", label: "Ready to send", fields: { email_status: "Ready to Send Email" }, tone: "go" }];
  if (l.email_status === "Ready to Send Email") return [{ key: "email:sent", label: "Mark email sent", fields: { email_status: "Email Sent", result: "Emailed", result_date: day(now) }, tone: "go" }];
  if (l.result === "Meeting") return [result("Client", "Won", "good"), result("Not interested", "Lost", "bad")];
  if (l.result === "Replied") return [result("Meeting", "Meeting booked", "go"), result("Client", "Won", "good"), result("Not interested", "Lost", "bad")];
  return [result("Replied", "Replied", "go"), result("Client", "Won", "good"), result("Not interested", "Lost", "bad"), result("Bounced", "Bounced", "plain")];
}

/** The next steps for a lead's WhatsApp track (only when it has a WhatsApp link). */
export function whatsappSteps(l: Lead): Step[] {
  if (!l.whatsapp) return [];
  const set = (v: string, label: string, tone: Step["tone"]): Step => ({ key: `wa:${v}`, label, fields: { whatsapp_status: v }, tone });
  switch (l.whatsapp_status) {
    case null:
    case undefined:
    case "":
      return [set("Waiting response for WhatsApp verification", "Asked to verify", "plain"), set("WhatsApp Verified", "Verified", "good")];
    case "Waiting response for WhatsApp verification":
      return [set("WhatsApp Verified", "Verified", "good"), set("False Whatsapp Number", "False number", "bad")];
    case "WhatsApp Verified":
      return [set("WhatsApp msg sent", "WhatsApp message sent", "go")];
    default:
      return [];
  }
}

/** The colour group of a status, for the table's chips (the words are always shown too). */
export function tone(status: string | null | undefined): "good" | "bad" | "go" | "wait" | "none" {
  if (!status) return "none";
  if (["Client", "Meeting", "Replied", "WhatsApp Verified"].includes(status)) return "good";
  if (["Not interested", "Bounced", "False Whatsapp Number"].includes(status)) return "bad";
  if (["Email Sent", "Emailed", "WhatsApp msg sent"].includes(status)) return "go";
  return "wait";
}

/** The drawer: business, website, location and industry in the header block; then contact, email, WhatsApp,
 *  pain point, the drafts, then the rest. The email and WhatsApp status are the header's chips, not rows. */
export const HEADER_FIELDS = ["business", "website", "location", "industry"];
export const DRAWER_ORDER = [
  "contact_person",
  "contact_role",
  "founder_linkedin",
  "linkedin_via",
  "business_email",
  "whatsapp",
  "phone",
  "pain_point",
  "draft_email",
  "draft_whatsapp",
  "draft_followup",
  "size",
  "package",
  "map_link",
  "evidence",
  "listing_evidence",
  "source_pages",
  "tools_on_site",
  "site_health",
  "lead_score",
  "found_by",
  "notes",
  "notion_uid",
  "created_at",
];
/** The workflow's own records: what Peek writes when a person presses a step,
 *  a result chip or Take it, and the Validator's email check. Not fields: the drawer shows them as one Activity strip
 *  above History, read-only (the result date can be moved there), and My view does not order them. Still in the data
 *  and the API. */
export const ACTIVITY_FIELDS = ["email_check", "sent_by", "sent_at", "follow_up_at", "follow_up_by", "result", "result_date"];
/** Shown but never edited by hand: derived, the Validator's measures, or the record of who did what. */
export const READ_ONLY = new Set(["email_check", "tools_on_site", "site_health", "lead_score", "sent_by", "sent_at", "follow_up_by", "found_by", "notion_uid", "created_at"]);
