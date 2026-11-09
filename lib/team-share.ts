// "Copy for WhatsApp" in the lead drawer: a short message for the team's group
// chat: the business, the lead's link, and the team's latest changes on it (the last five by people within seven days,
// newest first). Plain text with line breaks, no markdown. No email address or phone number goes into it: cell values
// are never quoted except the status and result words, and anything that reads as an address or a number is masked.
import { fieldLabel } from "./view-prefs";

export type ShareChange = { column: string; old: unknown; new: unknown; actor: { kind: string; name: string }; at: string; outcome: string };

export const SHARE_DAYS = 7;
export const SHARE_LIMIT = 5;

const EMAIL = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /\+?\d[\d\s().-]{6,}\d/g;
/** Email addresses and phone numbers out of a line of text. */
export const mask = (s: string) => s.replace(EMAIL, "[email]").replace(PHONE, "[number]");

const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
const pad = (n: number) => String(n).padStart(2, "0");
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

/** "today 14:10", "yesterday", or "3 Nov", in this browser's time. */
export function when(at: string, now: Date): string {
  const d = new Date(at);
  if (dayKey(d) === dayKey(now)) return `today ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (dayKey(d) === dayKey(y)) return "yesterday";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// what one press of a step or chip says; the cells it writes alongside (sent by, sent at, result date) are folded in
const LEAD: Record<string, (v: unknown) => string> = {
  email_status: (v) => (v === "Email Sent" ? "marked Email sent" : `set Email status to ${v}`),
  whatsapp_status: (v) => (v === "WhatsApp msg sent" ? "marked WhatsApp sent" : `set WhatsApp status to ${v}`),
  result: (v) => `set Result to ${v}`,
  follow_up_at: () => "marked Follow-up sent",
};
const FOLDED = new Set(["sent_by", "sent_at", "result_date", "follow_up_by"]);

function phrase(group: ShareChange[]): string {
  const lead = group.find((c) => LEAD[c.column] && !empty(c.new));
  if (lead) return LEAD[lead.column](lead.new);
  const cleared = group.filter((c) => empty(c.new) && !FOLDED.has(c.column));
  if (cleared.length && cleared.length === group.filter((c) => !FOLDED.has(c.column)).length) return `cleared ${cleared.map((c) => fieldLabel(c.column)).join(", ")}`;
  const cells = [...new Set(group.filter((c) => !FOLDED.has(c.column) && !empty(c.new)).map((c) => fieldLabel(c.column)))];
  return `set ${(cells.length ? cells : [...new Set(group.map((c) => fieldLabel(c.column)))]).join(", ")}`;
}

/** The team's latest changes on a lead as bullets: people only, applied, within seven days, one bullet per save (the
 *  cells one person wrote at the same moment), newest first, five at most. */
export function recentBullets(history: ShareChange[], now = new Date()): string[] {
  const since = now.getTime() - SHARE_DAYS * 86_400_000;
  const mine = history.filter((h) => h.actor.kind === "person" && h.outcome === "applied" && new Date(h.at).getTime() >= since);
  const groups = new Map<string, ShareChange[]>();
  for (const h of mine) {
    const k = `${h.actor.name}|${h.at}`;
    groups.set(k, [...(groups.get(k) ?? []), h]);
  }
  return [...groups.values()]
    .sort((a, b) => new Date(b[0].at).getTime() - new Date(a[0].at).getTime())
    .slice(0, SHARE_LIMIT)
    .map((g) => mask(`• ${g[0].actor.name} ${phrase(g)} (${when(g[0].at, now)})`));
}

/** The whole message: business, link, then the recent changes. */
export function shareText(o: { business: string; url: string; history: ShareChange[]; now?: Date }): string {
  const bullets = recentBullets(o.history, o.now);
  return [mask(o.business.trim() || "A lead"), o.url, "", "Recent changes:", ...(bullets.length ? bullets : ["• no changes by the team yet"])].join("\n");
}
