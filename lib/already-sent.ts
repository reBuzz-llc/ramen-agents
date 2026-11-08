// Leads → Mark already sent: sends from before the board existed (an import, a rebuild) are not on it,
// so Send next would offer those leads again. A person pastes the addresses from their mailbox's Sent folder (or a
// CSV export of it), the WhatsApp numbers they messaged, or a list of lead ids; this matches them to leads, previews what
// it would set and what Send next stops offering, and on confirm sets each lead's status as that person. The marks: Email
// sent (with the paste's date, else now, and Sent by), WhatsApp sent (the same), WhatsApp Verified, Ready to send email,
// or "as each line says" (a status name on the line: the Validator's list of the flags only a person may set). A lead
// already at that step or further is left alone. A person's edit, so it wins over the agents and shows in History. The
// paste is matched in memory and never stored.
import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./db";
import { leads } from "./db/schema";
import { WHATSAPP_SENT, writeLead, type Actor } from "./leads";

export type Mark = "email_sent" | "whatsapp_sent" | "whatsapp_verified" | "ready_email";
export type MarkChoice = Mark | "per_line";
export const MARKS: Record<Mark, { field: "email_status" | "whatsapp_status"; value: string; label: string; send: boolean }> = {
  email_sent: { field: "email_status", value: "Email Sent", label: "Email sent", send: true },
  whatsapp_sent: { field: "whatsapp_status", value: WHATSAPP_SENT, label: "WhatsApp sent", send: true },
  whatsapp_verified: { field: "whatsapp_status", value: "WhatsApp Verified", label: "WhatsApp Verified", send: false },
  ready_email: { field: "email_status", value: "Ready to Send Email", label: "Ready to send email", send: false },
};
/** How far along a track each status is: a mark never moves a lead back (Ready to send never undoes Email Sent). */
const STEP: Record<string, number> = { "Ready to Send Email": 1, "Email Sent": 2, "Waiting response for WhatsApp verification": 1, "WhatsApp Verified": 2, [WHATSAPP_SENT]: 3 };

export type Entry = { key: string; type: "id" | "email" | "number"; date: string | null; line: number; mark: Mark | null };
export type LeadLite = {
  id: string;
  notionPageId?: string | null;
  business: string;
  businessEmail: string | null;
  domain: string | null;
  whatsapp: string | null;
  phone: string | null;
  emailStatus: string | null;
  whatsappStatus: string | null;
  hasDraft?: boolean;
};
export type Match = {
  leadId: string;
  business: string;
  key: string;
  by: "id" | "email" | "domain" | "number";
  mark: Mark;
  date: string | null;
  already: boolean;
  hasDraft: boolean;
};
export type Preview = { mark: MarkChoice; entries: number; matched: Match[]; notFound: string[]; ambiguous: { key: string; leads: number }[]; noMark: string[] };

/** Addresses no business owns: matching one by its domain would mark every lead that uses it. */
export const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "ymail.com", "hotmail.com", "outlook.com", "live.com", "msn.com", "icloud.com", "me.com", "mac.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com", "yandex.com"]);
export const MAX_ENTRIES = 5000;

const EMAIL = /[\w.+'-]+@[\w-]+(?:\.[\w-]+)+/g;
const PHONE = /\+?\d[\d ()./-]{7,}\d/g;
const UUID = /\b[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}\b/gi;
const DATE =
  /\b(\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?|\d{1,2}\/\d{1,2}\/\d{2,4}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{1,2},? \d{4}|\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]* \d{4})\b/i;

/** A date on the line, as YYYY-MM-DD, or null. A day/month/year written with slashes is read as the US month/day. */
export function dateOn(line: string): string | null {
  const m = DATE.exec(line);
  if (!m) return null;
  let s = m[1];
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (us) s = `${us[3].length === 2 ? `20${us[3]}` : us[3]}-${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}`;
  const t = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T12:00:00` : s);
  if (!Number.isFinite(t.getTime())) return null;
  // the calendar day as written (local), never shifted by a time zone
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

/** The status a line names, if any (the longest name first, so "Email Sent" is not read inside another). */
export function markOn(line: string): Mark | null {
  const l = line.toLowerCase();
  for (const [mark, m] of Object.entries(MARKS).sort((a, b) => b[1].value.length - a[1].value.length)) if (l.includes(m.value.toLowerCase())) return mark as Mark;
  if (/\bwhatsapp sent\b/.test(l)) return "whatsapp_sent";
  return null;
}

export const digits = (s: string) => s.replace(/\D/g, "");
const hex = (s: string) => s.replace(/-/g, "").toLowerCase();

/** The paste as entries: each lead id, email address or phone number once, with the date and the status named on its
 *  line (the earliest date kept). A line with a lead id is matched by the id alone. */
export function parsePaste(text: string): Entry[] {
  const out = new Map<string, Entry>();
  text.split(/\r?\n/).forEach((raw, i) => {
    const date = dateOn(raw);
    const mark = markOn(raw);
    const ids = (raw.match(UUID) ?? []).map(hex);
    const keys: { key: string; type: Entry["type"] }[] = ids.length
      ? ids.map((key) => ({ key, type: "id" as const }))
      : [
          ...(raw.match(EMAIL) ?? []).map((e) => ({ key: e.toLowerCase().replace(/^['.]+|['.]+$/g, ""), type: "email" as const })),
          ...(raw.replace(EMAIL, " ").replace(new RegExp(DATE.source, "gi"), " ").match(PHONE) ?? []) // a date is not part of a number
            .map(digits)
            .filter((d) => d.length >= 9 && d.length <= 15)
            .map((key) => ({ key, type: "number" as const })),
        ];
    for (const { key, type } of keys) {
      const had = out.get(key);
      if (!had) out.set(key, { key, type, date, line: i + 1, mark });
      else {
        if (date && (!had.date || date < had.date)) had.date = date;
        had.mark ??= mark;
      }
    }
  });
  return [...out.values()].slice(0, MAX_ENTRIES);
}

const leadDigits = (l: LeadLite) => [l.whatsapp, l.phone].map((v) => digits(v ?? "")).filter((d) => d.length >= 9);

/** The entries against the board: a lead id (the portal's or Notion's), an exact business email, then the email's domain
 *  (never a free-mail one), or a number (with or without its country code). A key that fits more than one lead is listed,
 *  not marked; with "as each line says", a line that names no status is listed too. */
export function matchEntries(entries: Entry[], board: LeadLite[], choice: MarkChoice): Preview {
  const byId = new Map<string, LeadLite>();
  const byEmail = new Map<string, LeadLite[]>();
  const byDomain = new Map<string, LeadLite[]>();
  const push = (m: Map<string, LeadLite[]>, k: string, l: LeadLite) => m.set(k, [...(m.get(k) ?? []), l]);
  for (const l of board) {
    byId.set(hex(l.id), l);
    if (l.notionPageId) byId.set(hex(l.notionPageId), l);
    if (l.businessEmail) for (const e of l.businessEmail.toLowerCase().match(EMAIL) ?? []) push(byEmail, e, l);
    if (l.domain) push(byDomain, l.domain.toLowerCase().replace(/^www\./, ""), l);
  }
  const matched: Match[] = [];
  const notFound: string[] = [];
  const ambiguous: { key: string; leads: number }[] = [];
  const noMark: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const mark = choice === "per_line" ? e.mark : choice;
    if (!mark) {
      noMark.push(e.key);
      continue;
    }
    let hits: LeadLite[] = [];
    let by: Match["by"] = e.type === "id" ? "id" : e.type === "email" ? "email" : "number";
    if (e.type === "id") hits = byId.has(e.key) ? [byId.get(e.key)!] : [];
    else if (e.type === "email") {
      hits = byEmail.get(e.key) ?? [];
      if (!hits.length) {
        const domain = e.key.split("@")[1] ?? "";
        if (!FREE_MAIL.has(domain)) {
          hits = byDomain.get(domain) ?? [];
          by = "domain";
        }
      }
    } else hits = board.filter((l) => leadDigits(l).some((d) => d === e.key || d.endsWith(e.key) || e.key.endsWith(d)));
    if (hits.length > 1) {
      ambiguous.push({ key: e.key, leads: hits.length });
      continue;
    }
    if (!hits.length) {
      notFound.push(e.key);
      continue;
    }
    const l = hits[0];
    const m = MARKS[mark];
    if (seen.has(`${l.id}:${m.field}`)) continue;
    seen.add(`${l.id}:${m.field}`);
    const current = m.field === "email_status" ? l.emailStatus : l.whatsappStatus;
    const already = current === m.value || (STEP[current ?? ""] ?? 0) > (STEP[m.value] ?? 0);
    matched.push({ leadId: l.id, business: l.business, key: e.key, by, mark, date: e.date, already, hasDraft: !!l.hasDraft });
  }
  return { mark: choice, entries: entries.length, matched, notFound, ambiguous, noMark };
}

/** The board's live leads, with only what matching needs. */
export async function boardLite(db: Db, tenantId: string): Promise<LeadLite[]> {
  return db
    .select({
      id: leads.id,
      notionPageId: leads.notionPageId,
      business: leads.business,
      businessEmail: leads.businessEmail,
      domain: leads.domain,
      whatsapp: leads.whatsapp,
      phone: leads.phone,
      emailStatus: leads.emailStatus,
      whatsappStatus: leads.whatsappStatus,
      hasDraft: sql<boolean>`(${leads.draftEmail} is not null and ${leads.draftEmail} not ilike 'skip:%')`,
    })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.archived, false)));
}

/** Set each match not set yet, as `actor`, one write each (one failure never undoes another). A send keeps the paste's
 *  date as Sent at. */
export async function markSent(db: Db, tenantId: string, p: Preview, actor: Actor): Promise<{ marked: number; failed: { business: string; reason: string }[] }> {
  let marked = 0;
  const failed: { business: string; reason: string }[] = [];
  for (const m of p.matched) {
    if (m.already) continue;
    const mk = MARKS[m.mark];
    const sentAt = mk.send && m.date ? new Date(`${m.date}T12:00:00Z`) : null;
    try {
      const r = await writeLead(db, tenantId, { id: m.leadId }, { [mk.field]: mk.value }, actor, { sentAt });
      if (r.ok && r.written.length) marked++;
      else if (!r.ok) failed.push({ business: m.business, reason: r.message });
    } catch (err) {
      failed.push({ business: m.business, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { marked, failed };
}

/** What marking prevents: of the leads to be marked Email sent, how many Send next offers right now (its ids),
 *  and how many more have a draft waiting, so would come up later. */
export function prevented(p: Preview, sendNextIds: string[]): { now: number; later: number } {
  const offered = new Set(sendNextIds);
  const open = p.matched.filter((m) => !m.already && m.mark === "email_sent");
  const now = open.filter((m) => offered.has(m.leadId)).length;
  return { now, later: open.filter((m) => !offered.has(m.leadId) && m.hasDraft).length };
}
