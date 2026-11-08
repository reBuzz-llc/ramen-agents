// The family's reports for the team: the agents' day and week on /family, the reverse of the Guide.
// The Validator posts them with its key (POST /v1/family/report, scope board:validate); people only read them. The
// payload is checked here: known fields only, short plain text, and nothing that looks like a person's contact (an
// email address, a phone number) or a web address (except the week post's own link, wherever you publish it).
//
// The shapes (`kind` and `at` beside the payload; `at` optional, ISO 8601, default now):
//   tick:    {"kind": "tick", "at": "...", "today": {"drafts_landed": 12, "whatsapp_pitches": 4, "leads_listed": 6,
//             "no_site_share": 33, "polished_drafts": 2, "contact_roles": {"Founder": 3, "Owner": 1}},
//             "members": [{"name": "Lead Gen", "state": "working", "line": "searching for bakeries with no website"}]}
//   morning: {"kind": "morning", "at": "...", "lines": ["Drafts landed: 11-07 14, today so far 3", "..."]}
//   week:    {"kind": "week", "at": "...", "week": {"title": "This week in the family: ...", "summary": "...",
//             "url": "https://<where you publish it>/..."}}  (the fleet's scripts/family_week.py writes the post)
import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { Db } from "./db";
import { familyReports } from "./db/schema";

export const KINDS = ["tick", "morning", "week"] as const;
export type Kind = (typeof KINDS)[number];
export type Today = { drafts_landed?: number; whatsapp_pitches?: number; leads_listed?: number; no_site_share?: number; polished_drafts?: number; contact_roles?: Record<string, number> };
export type MemberLine = { name: string; state: string; line: string };
export type Report =
  | { kind: "tick"; today: Today; members: MemberLine[] }
  | { kind: "morning"; lines: string[] }
  | { kind: "week"; week: { title: string; summary: string; url: string } };
export type Stored = Report & { at: string };

const KEEP = 50;
const MAX_LINE = 300;
const MAX_LINES = 60;
const NUMBERS = ["drafts_landed", "whatsapp_pitches", "leads_listed", "no_site_share", "polished_drafts"] as const;

/** Why a line may not be shown, or "" when it may: an email address, a phone number or a web address in it. */
export function unmasked(s: string): string {
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(s)) return "an email address";
  if (/\+?\d[\d ()-]{8,}\d/.test(s)) return "a phone number";
  if (/https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|co|us|biz|info|io|shop|store|nyc)\b/i.test(s)) return "a web address";
  return "";
}

function text(v: unknown, what: string, max = MAX_LINE): string {
  if (typeof v !== "string") throw new Error(`${what} must be text`);
  const s = v.replace(/\s+/g, " ").trim();
  if (s.length > max) throw new Error(`${what} is longer than ${max} characters`);
  const why = unmasked(s);
  if (why) throw new Error(`${what} has ${why}: send masked text only`);
  return s;
}

function count(v: unknown, what: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1_000_000) throw new Error(`${what} must be a number from 0`);
  return Math.round(v);
}

/** The posted body as a report, or an error that says what to fix. */
export function parseReport(b: Record<string, unknown>): Report {
  const kind = b.kind;
  if (kind === "tick") {
    const t = (b.today ?? {}) as Record<string, unknown>;
    if (typeof t !== "object" || Array.isArray(t)) throw new Error("today must be an object");
    const today: Today = {};
    for (const k of NUMBERS) if (t[k] !== undefined) today[k] = count(t[k], `today.${k}`);
    if (today.no_site_share !== undefined && today.no_site_share > 100) throw new Error("today.no_site_share is a percentage (0 to 100)");
    if (t.contact_roles !== undefined) {
      const roles = t.contact_roles as Record<string, unknown>;
      if (!roles || typeof roles !== "object" || Array.isArray(roles)) throw new Error("today.contact_roles must be {role: count}");
      today.contact_roles = Object.fromEntries(Object.entries(roles).slice(0, 20).map(([r, n]) => [text(r, "a contact role", 60), count(n, `today.contact_roles.${r}`)]));
    }
    const ms = b.members ?? [];
    if (!Array.isArray(ms) || ms.length > 30) throw new Error("members must be a list (30 at most)");
    const members = ms.map((m, i) => {
      const o = (m ?? {}) as Record<string, unknown>;
      return { name: text(o.name, `members[${i}].name`, 60), state: text(o.state ?? "", `members[${i}].state`, 40), line: text(o.line ?? "", `members[${i}].line`) };
    });
    return { kind, today, members };
  }
  if (kind === "morning") {
    const ls = b.lines;
    if (!Array.isArray(ls) || !ls.length || ls.length > MAX_LINES) throw new Error(`lines must be a list of 1 to ${MAX_LINES} lines`);
    return { kind, lines: ls.map((l, i) => text(l, `lines[${i}]`)) };
  }
  if (kind === "week") {
    const w = (b.week ?? {}) as Record<string, unknown>;
    const url = typeof w.url === "string" ? w.url.trim() : "";
    let ok = false;
    try {
      ok = new URL(url).protocol === "https:" && url.length <= 300;
    } catch {
      ok = false;
    }
    if (!ok) throw new Error("week.url must be the post's https link");
    return { kind, week: { title: text(w.title, "week.title", 160), summary: text(w.summary ?? "", "week.summary"), url } };
  }
  throw new Error(`kind must be one of ${KINDS.join(", ")}`);
}

/** The report's time: `at` when it is a valid time no more than 10 minutes in the future, else now. */
export function reportAt(v: unknown, now = new Date()): Date {
  const t = typeof v === "string" ? new Date(v) : null;
  return t && Number.isFinite(t.getTime()) && t.getTime() <= now.getTime() + 600_000 ? t : now;
}

/** Store a report and keep only the newest 50 of its kind. */
export async function saveReport(d: Db, tenantId: string, r: Report, at: Date, postedBy: string): Promise<{ id: number; at: string }> {
  const { kind, ...lines } = r;
  const [row] = await d.insert(familyReports).values({ tenantId, kind, at, lines, postedBy }).returning();
  const keep = await d
    .select({ at: familyReports.at })
    .from(familyReports)
    .where(and(eq(familyReports.tenantId, tenantId), eq(familyReports.kind, kind)))
    .orderBy(desc(familyReports.at))
    .limit(1)
    .offset(KEEP - 1);
  if (keep[0]) await d.delete(familyReports).where(and(eq(familyReports.tenantId, tenantId), eq(familyReports.kind, kind), lt(familyReports.at, keep[0].at)));
  return { id: row.id, at: new Date(row.at).toISOString() };
}

/** The newest report of each kind, or null where none has come yet. */
export async function latestReports(d: Db, tenantId: string): Promise<{ tick: Stored | null; morning: Stored | null; week: Stored | null }> {
  const out: { tick: Stored | null; morning: Stored | null; week: Stored | null } = { tick: null, morning: null, week: null };
  await Promise.all(
    KINDS.map(async (kind) => {
      const [row] = await d
        .select()
        .from(familyReports)
        .where(and(eq(familyReports.tenantId, tenantId), inArray(familyReports.kind, [kind])))
        .orderBy(desc(familyReports.at))
        .limit(1);
      if (row) out[kind] = { kind, ...(row.lines as object), at: new Date(row.at).toISOString() } as Stored;
    }),
  );
  return out;
}

/** True when a report is older than `minutes` (the page's "this is old" line). */
export const olderThan = (iso: string, minutes: number, now = Date.now()) => now - new Date(iso).getTime() > minutes * 60_000;
