// Server-side only: how The CEO is measured (owner, 2026-10-06, "both"): per week, (1) tasks on its task board that
// the team (the people in team.json) moved to Status "Done", and (2) leads whose Result reached Replied, Meeting or
// Client. Tasks created is not a measure. A task's done week is its last edit by a team member (the board keeps no
// separate done date); a lead's is its Result date, else its last edit. Four weeks, newest first; cached 10 minutes.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR } from "./bots";
import { notionBoards } from "./notion-boards";

const KEYS = path.join(BOTS_DIR, "common-data", "keys", "notion.key");
const TEAM = path.join(BOTS_DIR, "common-data", "team.json");
const ANSWERED = new Set(["Replied", "Meeting", "Client"]);

export type CeoWeek = { from: string; tasksDone: number; leadsAnswered: number };
export type CeoMeasure = { ok: boolean; reason: string; weeks: CeoWeek[]; openTasks: number };

type Page = { last_edited_time?: string; last_edited_by?: { id?: string }; properties?: Record<string, Record<string, unknown>> };
const g = globalThis as { __ceoMeasure?: { at: number; data: CeoMeasure } };

async function queryAll(id: string, key: string): Promise<Page[]> {
  const out: Page[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`https://api.notion.com/v1/data_sources/${id}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Notion-Version": "2025-09-03", "Content-Type": "application/json" },
      body: JSON.stringify({ page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`Notion answered HTTP ${res.status}`);
    const b = (await res.json()) as { results?: Page[]; has_more?: boolean; next_cursor?: string };
    out.push(...(b.results ?? []));
    if (!b.has_more || !b.next_cursor) break;
    cursor = b.next_cursor;
  }
  return out;
}

const named = (p: Record<string, unknown> | undefined) => {
  const v = p?.[String(p?.type)] as { name?: string; start?: string } | null | undefined;
  return v?.name ?? v?.start ?? "";
};

export async function ceoMeasure(): Promise<CeoMeasure> {
  if (g.__ceoMeasure && Date.now() - g.__ceoMeasure.at < 10 * 60 * 1000) return g.__ceoMeasure.data;
  let key = "";
  let team = new Set<string>();
  try {
    key = (await readFile(/*turbopackIgnore: true*/ KEYS, "utf8")).trim();
    team = new Set(((JSON.parse(await readFile(/*turbopackIgnore: true*/ TEAM, "utf8")) as { members?: { notionId?: string }[] }).members ?? []).map((m) => String(m.notionId)));
  } catch {
    return { ok: false, reason: "No Notion key or team list on this Mac.", weeks: [], openTasks: 0 };
  }
  // Weeks end today: [today-6, today], the one before, and so on.
  const day = 86400e3;
  const now = Date.now();
  const weeks: CeoWeek[] = [0, 1, 2, 3].map((i) => ({ from: new Date(now - (7 * i + 6) * day).toISOString().slice(0, 10), tasksDone: 0, leadsAnswered: 0 }));
  const weekOf = (iso: string) => {
    const t = new Date(iso).getTime();
    if (!Number.isFinite(t) || t > now) return -1;
    const i = Math.floor((now - t) / (7 * day));
    return i < 4 ? i : -1;
  };
  try {
    const boards = await notionBoards();
    if (!boards.tasks || !boards.leads) return { ok: false, reason: "The task board or Leads board id is not set in the-ceo/config.toml.", weeks: [], openTasks: 0 };
    const [tasks, leads] = await Promise.all([queryAll(boards.tasks, key), queryAll(boards.leads, key)]);
    let openTasks = 0;
    for (const t of tasks) {
      const status = named(t.properties?.Status);
      if (status !== "Done") {
        if (status && status !== "Dublicate" && status !== "Duplicate") openTasks++;
        continue;
      }
      if (!team.has(String(t.last_edited_by?.id))) continue; // done by the team, not by a bot
      const w = weekOf(String(t.last_edited_time));
      if (w >= 0) weeks[w].tasksDone++;
    }
    for (const l of leads) {
      if (!ANSWERED.has(named(l.properties?.Result))) continue;
      const w = weekOf(named(l.properties?.["Result date"]) || String(l.last_edited_time));
      if (w >= 0) weeks[w].leadsAnswered++;
    }
    const data = { ok: true, reason: "", weeks, openTasks };
    g.__ceoMeasure = { at: now, data };
    return data;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err), weeks: [], openTasks: 0 };
  }
}
