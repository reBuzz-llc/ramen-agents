// Server-side only: what became of the leads (owner, 2026-10-06: measure results, not activity). Reads the Leads board
// from Notion or, when common.toml names a portal ([leads] portal_url), from the portal (lib/portal.ts): "Result" (Emailed / Replied / Meeting / Client / Not interested / Bounced) and "Result date", which the team sets. Grouped by where the lead came from (the daily candidate lists'
// sources, by the lead's website) and by industry. Until the board has a Result column this reports ready = false.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR, readConfig } from "./bots";
import { nameKey, offeredSources } from "./candidates";
import { fromNotion, fromPortal, summarise, type DraftCounts, type LeadRow, type Pipeline, type ResultGroup } from "./lead-rows";
import { notionBoards } from "./notion-boards";
import { leadsSource, portalLeads } from "./portal";

const KEY_FILE = path.join(BOTS_DIR, "common-data", "keys", "notion.key");
const STAGES = ["Not contacted", "Emailed", "Replied", "Meeting", "Client", "Not interested", "Bounced"] as const;
export type { DraftCounts, Pipeline, ResultGroup };
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
  // The queue's column is the Outreach Writer's own setting ([leads] draft_queue_column), on Notion; the portal's is draft_email.
  let column = "Draft email";
  try {
    const cfg = await readConfig(path.join(BOTS_DIR, "outreach-writer", "config.toml"));
    column = String(cfg.get("leads.draft_queue_column") ?? column).trim() || column;
  } catch {
    /* no Outreach Writer in this family: the default only decides whether the board has the column */
  }
  const src = await leadsSource();
  let rows: LeadRow[] = [];
  if (src.store === "portal") {
    try {
      rows = (await portalLeads(src.url)).map(fromPortal);
    } catch (err) {
      return empty(err instanceof Error ? err.message : String(err));
    }
  } else {
    let key = "";
    try {
      key = (await readFile(/*turbopackIgnore: true*/ KEY_FILE, "utf8")).trim();
    } catch {
      return empty("No Notion key on this Mac.");
    }
    const { leads: LEADS_SOURCE } = await notionBoards();
    if (!LEADS_SOURCE) return empty("The Leads board id is not set in the-ceo/config.toml ([leads] database_id).");
    const headers = { Authorization: `Bearer ${key}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" };
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
        const body = (await res.json()) as { results?: { last_edited_time?: string; properties?: Record<string, Record<string, unknown>> }[]; has_more?: boolean; next_cursor?: string };
        for (const r of body.results ?? []) rows.push(fromNotion(r.properties ?? {}, r.last_edited_time ?? "", column));
        if (!body.has_more || !body.next_cursor) break;
        cursor = body.next_cursor;
      }
    } catch (err) {
      return empty(`Could not reach Notion: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (!rows.length) return empty("The Leads board is empty.");
  if (!rows.some((r) => r.has.result)) return empty("The Leads board has no Result column yet: the team fills it in.");

  const sources = await offeredSources();
  const host = (u: string) => {
    try {
      return new URL(u).hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  const sum = summarise(rows, (r) => sources.get(host(r.website)) ?? sources.get(nameKey(r.business)) ?? "Web search or added by hand", column);
  const data: LeadResults = {
    ready: true,
    reason: "",
    total: sum.total,
    stages: STAGES,
    pipeline: sum.pipeline,
    bySource: sum.bySource,
    byIndustry: sum.byIndustry,
    drafts: sum.drafts,
    whatsapp: sum.whatsapp,
    whatsappDrafts: sum.whatsappDrafts,
    mapLinks: sum.mapLinks,
    whatsappVerified: sum.whatsappVerified,
    whatsappFalse: await falseNumbers(),
    noted: await notedLeads(),
    sending: { sent: sum.sent, repliesWeek: sum.repliesWeek, team: await teamNames() },
  };
  g.__leadResults = { at: Date.now(), data };
  return data;
}
