// The drawer's Activity strip: the records Peek writes itself when a person
// works a lead (sent, followed up, the result, who holds it) and the Validator's email check, each as one short phrase
// ("Email sent by Jasmine, 10 Nov"). Read-only: the steps, the result chips and Take it set them. Pure, so it is tested.
// lib/leads.ts's WHATSAPP_SENT, repeated here so the drawer does not import the database side (a test keeps them equal)
export const WHATSAPP_SENT_MARK = "WhatsApp msg sent";

export type ActivityLine = { key: string; text: string };
type Lead = Record<string, unknown>;
type Change = { column: string; at: string; outcome: string };

const str = (v: unknown) => (v === null || v === undefined ? "" : Array.isArray(v) ? v.filter(Boolean).join(", ") : String(v).trim());

/** "10 Nov" (and the year when it is not this year's). A date-only value is read as that calendar day. */
export function shortDate(v: unknown, now = new Date()): string {
  const s = str(v);
  if (!s) return "";
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(s);
  const d = new Date(dateOnly ? `${s}T12:00:00Z` : s);
  if (Number.isNaN(d.getTime())) return s;
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", ...(dateOnly ? { timeZone: "UTC" } : {}) };
  if (d.getFullYear() !== now.getFullYear()) opts.year = "numeric";
  return d.toLocaleDateString("en-GB", opts);
}

const phrase = (head: string, date: string) => (date ? `${head}, ${date}` : head);

export function activityOf(lead: Lead, history: Change[], holder: string | null, now = new Date()): ActivityLine[] {
  const out: ActivityLine[] = [];
  const check = str(lead.email_check);
  if (check) {
    const at = history.filter((h) => h.column === "email_check" && h.outcome === "applied").map((h) => h.at).sort().pop();
    out.push({ key: "email_check", text: phrase(`Email check: ${check}`, shortDate(at, now)) });
  }
  const email = str(lead.email_status) === "Email Sent";
  const wa = str(lead.whatsapp_status) === WHATSAPP_SENT_MARK;
  const by = str(lead.sent_by);
  if (by || str(lead.sent_at)) {
    const what = email && wa ? "Email and WhatsApp sent" : email ? "Email sent" : wa ? "WhatsApp sent" : "Sent";
    out.push({ key: "sent", text: phrase(by ? `${what} by ${by}` : what, shortDate(lead.sent_at, now)) });
  }
  const fby = str(lead.follow_up_by);
  if (fby || str(lead.follow_up_at)) out.push({ key: "follow_up", text: phrase(fby ? `Follow-up by ${fby}` : "Follow-up sent", shortDate(lead.follow_up_at, now)) });
  const result = str(lead.result);
  if (result) out.push({ key: "result", text: phrase(`Result: ${result}`, shortDate(lead.result_date, now)) });
  if (holder) out.push({ key: "claim", text: holder });
  return out;
}
