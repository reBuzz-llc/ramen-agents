// Server-side only: what became of the leads (owner, 2026-10-06: measure results, not activity). Reads the Leads board
// on Notion: "Result" (a select or status the team sets: Emailed / Replied / Meeting / Client / Not interested / Bounced)
// and "Result date", which the bots never write. Grouped by where the lead came from (the daily candidate lists'
// sources, by the lead's website) and by industry. Until the board has a Result column this reports ready = false.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR } from "./bots";
import { offeredSources } from "./candidates";
import { notionBoards } from "./notion-boards";

const KEY_FILE = path.join(BOTS_DIR, "common-data", "keys", "notion.key");
const STAGES = ["Not contacted", "Emailed", "Replied", "Meeting", "Client", "Not interested", "Bounced"] as const;
// The furthest a lead got: a client was also emailed, replied and met.
const RANK: Record<string, number> = { Emailed: 1, Replied: 2, Meeting: 3, Client: 4 };

export type ResultGroup = { label: string; leads: number; byResult: Record<string, number> };
export type LeadResults = { ready: boolean; reason: string; total: number; stages: readonly string[]; bySource: ResultGroup[]; byIndustry: ResultGroup[] };

const g = globalThis as { __leadResults?: { at: number; data: LeadResults } };

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

export async function leadResults(): Promise<LeadResults> {
  if (g.__leadResults && Date.now() - g.__leadResults.at < 10 * 60 * 1000) return g.__leadResults.data;
  const empty = (reason: string): LeadResults => ({ ready: false, reason, total: 0, stages: STAGES, bySource: [], byIndustry: [] });
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
  const add = (map: Map<string, ResultGroup>, label: string, result: string) => {
    const g2 = map.get(label) ?? { label, leads: 0, byResult: {} };
    g2.leads++;
    const r = result || "Not contacted";
    g2.byResult[r] = (g2.byResult[r] ?? 0) + 1;
    // Count a lead at every stage up to the furthest it reached, so the funnel reads emailed -> replied -> client.
    for (const [stage, rank] of Object.entries(RANK)) if ((RANK[r] ?? 0) > rank) g2.byResult[`reached ${stage}`] = (g2.byResult[`reached ${stage}`] ?? 0) + 1;
    map.set(label, g2);
  };
  for (const p of rows) {
    const result = text(p.Result);
    const h = host(text(p.Website));
    add(groups.source, sources.get(h) ?? "Other (owner's list, web search)", result);
    add(groups.industry, (text(p.Industry) || "Unknown").split(/[,;/]/)[0].trim().slice(0, 30), result);
  }
  const sort = (m: Map<string, ResultGroup>) => [...m.values()].sort((a, b) => b.leads - a.leads);
  const data: LeadResults = { ready: true, reason: "", total: rows.length, stages: STAGES, bySource: sort(groups.source), byIndustry: sort(groups.industry).slice(0, 8) };
  g.__leadResults = { at: Date.now(), data };
  return data;
}
