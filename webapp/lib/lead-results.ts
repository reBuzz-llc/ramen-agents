// Server-side only: what became of the leads (owner, 2026-10-06: measure results, not activity). Reads the Leads board
// on Notion: "Result" (a select or status the team sets: Emailed / Replied / Meeting / Client / Not interested / Bounced)
// and "Result date", which the bots never write. Grouped by where the lead came from (the daily candidate lists'
// sources, by the lead's website) and by industry. Until the board has a Result column this reports ready = false.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR, readConfig } from "./bots";
import { nameKey, offeredSources } from "./candidates";
import { notionBoards } from "./notion-boards";

const KEY_FILE = path.join(BOTS_DIR, "common-data", "keys", "notion.key");
const STAGES = ["Not contacted", "Emailed", "Replied", "Meeting", "Client", "Not interested", "Bounced"] as const;
// The furthest a lead got: a client was also emailed, replied and met.
const RANK: Record<string, number> = { Emailed: 1, Replied: 2, Meeting: 3, Client: 4 };

// Per group (a source, an industry), how far its leads got: drafted by the Outreach Writer, sent by the team (Status
// "Email Sent", or any Result past it), answered, met, won. Each step counts the leads that reached it or went further.
export type ResultGroup = { label: string; leads: number; drafted: number; sent: number; replied: number; meeting: number; client: number };
export type Pipeline = Omit<ResultGroup, "label">;
// The Outreach Writer's first emails (2026-10-07): rows at the queue stage get a draft or "skip: <why>" in the draft
// column, oldest first; it never sends. Null until the board has the column.
export type DraftCounts = { column: string; stage: string; drafted: number; skipped: number; waiting: number };
export type LeadResults = { ready: boolean; reason: string; total: number; stages: readonly string[]; pipeline: Pipeline; bySource: ResultGroup[]; byIndustry: ResultGroup[]; drafts: DraftCounts | null;
  // Leads whose own site publishes a WhatsApp link ("Whatsapp" column, owner 2026-10-07); null until the column exists.
  whatsapp: number | null;
  // The Outreach Writer's WhatsApp first messages ("Draft Whatsapp msg") and Lead Gen's map links ("google map location"),
  // both from 2026-10-10; null until the board has the column.
  whatsappDrafts: number | null;
  mapLinks: number | null;
  // Rows the owner checked by hand in WhatsApp Web (Status "WhatsApp Verified", 2026-10-07). Not a review of the email.
  whatsappVerified: number;
  // Numbers a person found are not on WhatsApp: the Validator clears those rows and keeps the numbers in
  // shared-state/whatsapp-false-numbers.json (2026-10-07), so the count comes from that list, not the Status.
  whatsappFalse: number;
  // Businesses Lead Gen noted with an email but never listed (engine writes shared-state/lead-gen-noted.json each cycle).
  noted: NotedLeads | null;
  // The team's sending (2026-10-10): rows at Status "Email Sent", and answers whose Result date is in the last 7 days.
  sending: { sent: number; repliesWeek: number; team: string[] } };
export type NotedLeads = { waiting: number; oldest: string; titles: string[] };

const g = globalThis as { __leadResults?: { at: number; data: LeadResults } };

// The board's Industry cell is free text ("Restaurant", "Food & Beverage", "Educational Support Services"): a few plain
// groups so the same trade is counted once. First match wins; anything else is "Other", an empty cell "Unknown".
const INDUSTRY_GROUPS: [string, RegExp][] = [
  ["Franchises and chains", /^franchise|franchis/i],
  ["Food and drink", /restaurant|food|cafe|caf\u00e9|coffee|bakery|baked|catering|beverage|\bbar\b|eatery|pizza|deli|grill|kitchen|dessert|juice|wine|liquor/i],
  ["Beauty and fitness", /salon|hair|beauty|spa\b|nail|barber|gym|fitness|yoga|pilates|massage|skin|facial|wellness club/i],
  ["Health and care", /health|clinic|dental|medical|therap|counsel|care\b|senior|pharma|doctor|surgery|wellness|mental|pediatric|podiat|optometr|physician|speech|patholog/i],
  ["Education and childcare", /educat|school|tutor|child|learning|academy|music|dance|kids|camp|daycare|youth|sport|soccer|golf|coach/i],
  ["Events, arts and media", /event|party|production|film|photo|media|studio|\bart|gallery|entertain|theater|theatre|creative/i],
  ["Professional services", /consult|law|legal|account|insurance|financ|real estate|marketing|agency|management|staffing|security|business|engineer|architect|public relations|printing|property|vending|\bmbe\b/i],
  ["Home and trades", /construct|contract|plumb|electric|clean|pest|hardware|repair|home|roof|hvac|landscap|moving|develop|tint|wash/i],
  ["Shops", /store|shop|retail|boutique|apparel|fashion|gift|florist|flower|jewel|supplies/i],
];
function industryGroup(raw: string): string {
  const s = raw.trim();
  if (!s) return "Unknown";
  return INDUSTRY_GROUPS.find(([, re]) => re.test(s))?.[0] ?? "Other";
}

function text(p: Record<string, unknown> | undefined): string {
  if (!p) return "";
  const t = p.type as string;
  const v = p[t] as unknown;
  if (t === "select" || t === "status") return String((v as { name?: string } | null)?.name ?? "");
  if (t === "url" || t === "email") return String(v ?? "");
  if (t === "date") return String((v as { start?: string } | null)?.start ?? "");
  if (Array.isArray(v)) return v.map((x) => String((x as { plain_text?: string }).plain_text ?? "")).join("");
  return "";
}

async function teamNames(): Promise<string[]> {
  try {
    const doc = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(BOTS_DIR, "common-data", "team.json"), "utf8")) as { members?: { name?: string }[] };
    return (doc.members ?? []).map((m) => String(m.name ?? "").split(" ")[0]).filter((n) => n && !n.startsWith("FILL-ME"));
  } catch {
    return [];
  }
}

async function notedLeads(): Promise<NotedLeads | null> {
  try {
    const raw = await readFile(/*turbopackIgnore: true*/ path.join(BOTS_DIR, "common-data", "shared-state", "lead-gen-noted.json"), "utf8");
    const items = ((JSON.parse(raw) as { items?: { title?: string; noted_at?: string }[] }).items ?? []).filter((i) => i && typeof i === "object");
    const dates = items.map((i) => String(i.noted_at ?? "")).filter(Boolean).sort();
    return { waiting: items.length, oldest: dates[0] ?? "", titles: items.slice(0, 5).map((i) => String(i.title ?? "")) };
  } catch {
    return null;
  }
}

async function falseNumbers(): Promise<number> {
  try {
    const raw = await readFile(/*turbopackIgnore: true*/ path.join(BOTS_DIR, "common-data", "shared-state", "whatsapp-false-numbers.json"), "utf8");
    return Object.keys(JSON.parse(raw) as Record<string, unknown>).length;
  } catch {
    return 0;
  }
}

export async function leadResults(): Promise<LeadResults> {
  if (g.__leadResults && Date.now() - g.__leadResults.at < 10 * 60 * 1000) return g.__leadResults.data;
  const empty = (reason: string): LeadResults => ({ ready: false, reason, total: 0, stages: STAGES, pipeline: { leads: 0, drafted: 0, sent: 0, replied: 0, meeting: 0, client: 0 }, bySource: [], byIndustry: [], drafts: null, whatsapp: null, whatsappDrafts: null, mapLinks: null, whatsappVerified: 0, whatsappFalse: 0, noted: null, sending: { sent: 0, repliesWeek: 0, team: [] } });
  let key = "";
  try {
    key = (await readFile(/*turbopackIgnore: true*/ KEY_FILE, "utf8")).trim();
  } catch {
    return empty("No Notion key on this Mac.");
  }
  const { leads: LEADS_SOURCE } = await notionBoards();
  if (!LEADS_SOURCE) return empty("The Leads board id is not set in the-ceo/config.toml ([leads] database_id).");
  const headers = { Authorization: `Bearer ${key}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" };
  const rows: Record<string, Record<string, unknown>>[] = [];
  let cursor: string | undefined;
  try {
    for (let i = 0; i < 20; i++) {
      const res = await fetch(`https://api.notion.com/v1/data_sources/${LEADS_SOURCE}/query`, {
        method: "POST",
        headers,
        body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
        signal: AbortSignal.timeout(20000),
      });
      if (!res.ok) return empty(`Notion answered HTTP ${res.status}.`);
      const body = (await res.json()) as { results?: { properties?: Record<string, Record<string, unknown>> }[]; has_more?: boolean; next_cursor?: string };
      for (const r of body.results ?? []) rows.push(r.properties ?? {});
      if (!body.has_more || !body.next_cursor) break;
      cursor = body.next_cursor;
    }
  } catch (err) {
    return empty(`Could not reach Notion: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!rows.length) return empty("The Leads board is empty.");
  if (!rows.some((p) => "Result" in p)) return empty("The Leads board has no Result column yet: the team fills it in.");

  const sources = await offeredSources();
  const host = (u: string) => {
    try {
      return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const groups = { source: new Map<string, ResultGroup>(), industry: new Map<string, ResultGroup>() };
  const pipeline: Pipeline = { leads: 0, drafted: 0, sent: 0, replied: 0, meeting: 0, client: 0 };
  const bump = (g2: Pipeline, p: Record<string, Record<string, unknown>>) => {
    const r = text(p.Result);
    const rank = RANK[r] ?? (r === "Not interested" ? 2 : r === "Bounced" ? 1 : 0);
    const draft = text(p["Draft email"]).trim();
    g2.leads++;
    if ((draft && !/^skip\s*:/i.test(draft)) || rank || text(p.Status) === "Email Sent") g2.drafted++;
    if (rank >= 1 || text(p.Status) === "Email Sent") g2.sent++;
    if (rank >= 2) g2.replied++;
    if (rank >= 3) g2.meeting++;
    if (rank >= 4) g2.client++;
  };
  const add = (map: Map<string, ResultGroup>, label: string, p: Record<string, Record<string, unknown>>) => {
    const g2 = map.get(label) ?? { label, leads: 0, drafted: 0, sent: 0, replied: 0, meeting: 0, client: 0 };
    bump(g2, p);
    map.set(label, g2);
  };
  for (const p of rows) {
    bump(pipeline, p);
    add(groups.source, sources.get(host(text(p.Website))) ?? sources.get(nameKey(text(p.Business))) ?? "Web search or added by hand", p);
    add(groups.industry, industryGroup(text(p.Industry)), p);
  }
  // The queue's column is the Outreach Writer's own setting ([leads] draft_queue_column). The board has no Stage column
  // since 2026-10-10: a row still to draft is one with no draft, not sent (Status) and no Result.
  let column = "Draft email";
  const stage = "";
  try {
    const cfg = await readConfig(path.join(BOTS_DIR, "outreach-writer", "config.toml"));
    column = String(cfg.get("leads.draft_queue_column") ?? column).trim() || column;
  } catch {
    /* no Outreach Writer in this family: the defaults only decide whether the board has the column */
  }
  let drafts: DraftCounts | null = null;
  if (rows.some((p) => column in p)) {
    drafts = { column, stage, drafted: 0, skipped: 0, waiting: 0 };
    for (const p of rows) {
      const d = text(p[column]).trim();
      if (/^skip\s*:/i.test(d)) drafts.skipped++;
      else if (d) drafts.drafted++;
      else if (text(p.Status) !== "Email Sent" && !text(p.Result)) drafts.waiting++;
    }
  }
  const weekAgo = new Date(Date.now() - 7 * 86400e3).toISOString().slice(0, 10);
  const answered = new Set(["Replied", "Meeting", "Client", "Not interested"]);
  const sending = {
    sent: rows.filter((p) => text(p.Status) === "Email Sent").length,
    repliesWeek: rows.filter((p) => answered.has(text(p.Result)) && text(p["Result date"]).slice(0, 10) >= weekAgo).length,
    team: await teamNames(),
  };
  const sort = (m: Map<string, ResultGroup>) => [...m.values()].sort((a, b) => b.leads - a.leads);
  const data: LeadResults = { ready: true, reason: "", total: rows.length, stages: STAGES, pipeline, bySource: sort(groups.source), byIndustry: sort(groups.industry), drafts,
    whatsapp: rows.some((p) => "Whatsapp" in p) ? rows.filter((p) => text(p.Whatsapp).trim()).length : null,
    whatsappDrafts: rows.some((p) => "Draft Whatsapp msg" in p)
      ? rows.filter((p) => { const d = text(p["Draft Whatsapp msg"]).trim(); return d && !/^skip\s*:/i.test(d); }).length
      : null,
    mapLinks: rows.some((p) => "google map location" in p) ? rows.filter((p) => text(p["google map location"]).trim()).length : null,
    whatsappVerified: rows.filter((p) => text(p.Status) === "WhatsApp Verified").length,
    whatsappFalse: await falseNumbers(),
    noted: await notedLeads(),
    sending };
  g.__leadResults = { at: Date.now(), data };
  return data;
}
