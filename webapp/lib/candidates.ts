// Server-side only: what Lead Gen's daily candidate lists achieve, per source (owner, 2026-10-05: are the NYC city
// list and FreeSerp worth it?). Reads the files scripts/candidates-feed.py writes (common-data/botBox/routed/lead-gen/
// candidates-<market>-DATE.md, a "## From ..." section per source) and Lead Gen's own database: a candidate is
// "visited" when Lead Gen opened a page on its site after the list came out, and a "lead" when an accepted lead or
// lead fix names that site. Read-only.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { BotProfile } from "./bot";
import { BOTS_DIR } from "./bots";
import { dbPath, query } from "./episodes";
import { sq } from "./summary";

const DIR = path.join(BOTS_DIR, "common-data", "botBox", "routed", "lead-gen");

export type SourceFunnel = { source: string; candidates: number; visited: number; leads: number };
export type CandidateFunnel = { days: number; files: number; sources: SourceFunnel[]; lastFile: string | null };

const host = (u: string) => {
  try {
    return new URL(u.trim()).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
};

// A candidate's key: its website's host, or, for a business with no website (its line links the public record), its
// name, so fifty register rows do not collapse into the register's one host.
export const nameKey = (name: string) => "name:" + name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
function keyOf(line: string, source: string): string {
  if (/no website/i.test(source)) return nameKey(line.slice(2).split(" | ")[0]);
  const url = line.split(" | ").find((p) => /^https?:\/\//.test(p.trim()));
  return url ? host(url) : "";
}

function sourceOf(heading: string): string {
  if (/re-check/i.test(heading)) return "Re-check (refused before)";
  if (/no website/i.test(heading)) return "City open data, no website";
  if (/freeserp/i.test(heading)) return "FreeSerp";
  if (/overture/i.test(heading)) return "Overture Maps";
  if (/open data|nyc|city/i.test(heading)) return "City open data";
  return heading.replace(/^##\s*From\s*/i, "").slice(0, 40) || "Candidates";
}

export async function candidateFunnel(leadGen: BotProfile | undefined, days = 7): Promise<CandidateFunnel> {
  const names = (await readdir(/*turbopackIgnore: true*/ DIR).catch(() => [] as string[])).filter((f) => /^candidates-.+-\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  const recent = names.slice(-days);
  // host -> {source, date the list offered it (first time)}
  const offered = new Map<string, { source: string; date: string }>();
  for (const f of recent) {
    const date = f.slice(-13, -3);
    let text = "";
    try {
      text = await readFile(/*turbopackIgnore: true*/ path.join(DIR, f), "utf8");
    } catch {
      continue;
    }
    let source = "City open data"; // files written before the per-source sections
    for (const line of text.split("\n")) {
      if (line.startsWith("## ")) source = sourceOf(line);
      if (!line.startsWith("- ")) continue;
      const h = keyOf(line, source);
      if (h && !offered.has(h)) offered.set(h, { source, date });
    }
  }
  const visited = new Set<string>();
  const leads = new Set<string>();
  if (leadGen && offered.size) {
    const since = recent[0]?.slice(-13, -3) ?? "";
    try {
      const db = await dbPath(leadGen);
      const [visits, made] = await Promise.all([
        query(db, `SELECT DISTINCT lower(domain) AS d, min(visited_at) AS t FROM visits WHERE visited_at >= ${sq(since)} GROUP BY 1`),
        query(db, `SELECT payload FROM actions WHERE ts >= ${sq(since)} AND verdict = 'allowed' AND action_type IN ('lead','update_lead')`),
      ]);
      for (const v of visits) {
        const h = String(v.d).replace(/^www\./, "");
        const o = offered.get(h);
        if (o && String(v.t).slice(0, 10) >= o.date) visited.add(h);
      }
      for (const m of made) {
        try {
          const lead = JSON.parse(String(m.payload)) as { website?: string; name?: string; business?: string };
          const h = host(lead.website ?? "");
          if (offered.has(h)) leads.add(h);
          const n = nameKey(lead.name ?? lead.business ?? "");
          if (offered.has(n)) leads.add(n);
        } catch {
          /* a payload that is not JSON */
        }
      }
    } catch {
      /* no database yet */
    }
  }
  const bySource = new Map<string, SourceFunnel>();
  for (const [h, o] of offered) {
    const s = bySource.get(o.source) ?? { source: o.source, candidates: 0, visited: 0, leads: 0 };
    s.candidates++;
    if (visited.has(h)) s.visited++;
    if (leads.has(h)) s.leads++;
    bySource.set(o.source, s);
  }
  return { days, files: recent.length, sources: [...bySource.values()].sort((a, b) => b.candidates - a.candidates), lastFile: recent.at(-1) ?? null };
}

/** Every site any daily list has offered, with the source that offered it first (all files, not only the last week). */
export async function offeredSources(): Promise<Map<string, string>> {
  const names = (await readdir(/*turbopackIgnore: true*/ DIR).catch(() => [] as string[])).filter((f) => /^candidates-.+-\d{4}-\d{2}-\d{2}\.md$/.test(f)).sort();
  const out = new Map<string, string>();
  for (const f of names) {
    const text = await readFile(/*turbopackIgnore: true*/ path.join(DIR, f), "utf8").catch(() => "");
    let source = "City open data";
    for (const line of text.split("\n")) {
      if (line.startsWith("## ")) source = sourceOf(line);
      if (!line.startsWith("- ")) continue;
      const h = keyOf(line, source);
      if (h && !out.has(h)) out.set(h, source);
    }
  }
  return out;
}
