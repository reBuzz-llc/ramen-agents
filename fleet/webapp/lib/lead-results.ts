// Server-side only: what became of the leads (owner, 2026-10-06: measure results, not activity). Reads the Leads board
// from the Leads board (the local board, or the hosted portal when common.toml names one: lib/portal.ts): "Result" (Emailed / Replied / Meeting / Client / Not interested / Bounced) and "Result date", which the team sets. Grouped by where the lead came from (the daily candidate lists'
// sources, by the lead's website) and by industry. Until the board has a Result column this reports ready = false.
import { teamPeople } from "./family";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR, readConfig } from "./bots";
import { nameKey, offeredSources } from "./candidates";
import { fromPortal, summarise, type DraftCounts, type LeadRow, type Pipeline, type ResultGroup } from "./lead-rows";
import { boardLeads } from "./portal";

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
  return (await teamPeople()).map((n) => n.split(" ")[0]);
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
  // The queue's column is the Outreach Writer's own setting ([leads] draft_queue_column); the board's is draft_email.
  let column = "Draft email";
  try {
    const cfg = await readConfig(path.join(BOTS_DIR, "outreach-writer", "config.toml"));
    column = String(cfg.get("leads.draft_queue_column") ?? column).trim() || column;
  } catch {
    /* no Outreach Writer in this family: the default only decides whether the board has the column */
  }
  let rows: LeadRow[] = [];
  try {
    rows = (await boardLeads()).map(fromPortal);
  } catch (err) {
    return empty(err instanceof Error ? err.message : String(err));
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
