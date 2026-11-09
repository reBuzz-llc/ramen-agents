// Server-side only: how The CEO is measured: per week, (1) tasks on the team's task board
// that a person moved to Done, and (2) leads whose Result reached Replied, Meeting or Client. Tasks created is not a
// measure. The tasks are the team portal's (a Notion board frozen after a move would read 0 for
// four weeks): a task counts in the week of its newest step to Done made by a person, from its History. A lead's week is
// its Result date, else its last edit. Four weeks, newest first; cached 10 minutes.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR } from "./bots";
import { CLOSED_TASK, doneByPerson, weekIndex, type PortalTask, type TaskStep } from "./checks";
import { fromNotion, fromPortal, type LeadRow } from "./lead-rows";
import { notionBoards } from "./notion-boards";
import { leadsSource, portalKey, portalLeads } from "./portal";

const KEYS = path.join(BOTS_DIR, "common-data", "keys", "notion.key");
const ANSWERED = new Set(["Replied", "Meeting", "Client"]);

export type CeoWeek = { from: string; tasksDone: number; leadsAnswered: number };
export type CeoMeasure = { ok: boolean; reason: string; weeks: CeoWeek[]; openTasks: number; tasksSource?: string };

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


/** The portal's task board with the dashboard's key: every live task, then the History of those Done in the last four weeks. */
async function portalTasks(url: string, key: string, now: number): Promise<{ open: number; done: string[] }> {
  const get = async (p: string) => {
    const r = await fetch(`${url}${p}`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000), cache: "no-store" });
    if (!r.ok) throw new Error(`The team portal answered HTTP ${r.status} for the task board`);
    return r.json();
  };
  const tasks: PortalTask[] = [];
  let since = 0;
  for (let i = 0; i < 20; i++) {
    const b = (await get(`/v1/boards/tasks/rows?since=${since}&limit=500`)) as { tasks?: PortalTask[]; next?: number; more?: boolean };
    tasks.push(...(b.tasks ?? []));
    if (!b.more) break;
    since = Number(b.next ?? since);
  }
  const open = tasks.filter((t) => t.status && !CLOSED_TASK.has(t.status)).length;
  const recent = tasks.filter((t) => t.status === "Done" && weekIndex(String(t.updated_at ?? ""), now) >= 0).slice(0, 200);
  const done: string[] = [];
  for (const t of recent) {
    const h = (await get(`/v1/tasks/${t.id}/history`)) as { history?: TaskStep[] } | TaskStep[];
    const at = doneByPerson(Array.isArray(h) ? h : (h.history ?? []));
    if (at) done.push(at);
  }
  return { open, done };
}

export async function ceoMeasure(): Promise<CeoMeasure> {
  if (g.__ceoMeasure && Date.now() - g.__ceoMeasure.at < 10 * 60 * 1000) return g.__ceoMeasure.data;
  // Weeks end today: [today-6, today], the one before, and so on.
  const day = 86400e3;
  const now = Date.now();
  const weeks: CeoWeek[] = [0, 1, 2, 3].map((i) => ({ from: new Date(now - (7 * i + 6) * day).toISOString().slice(0, 10), tasksDone: 0, leadsAnswered: 0 }));
  try {
    const src = await leadsSource();
    const portalKeyText = (await readFile(/*turbopackIgnore: true*/ portalKey(), "utf8").catch(() => "")).trim();
    if (!portalKeyText) return { ok: false, reason: "source not connected: no team portal key for the dashboard (common-data/keys/portal-dashboard.key)", weeks: [], openTasks: 0 };
    const leadsP: Promise<LeadRow[]> =
      src.store === "portal"
        ? portalLeads(src.url).then((ls) => ls.map(fromPortal))
        : (async () => {
            const key = (await readFile(/*turbopackIgnore: true*/ KEYS, "utf8")).trim();
            const boards = await notionBoards();
            if (!boards.leads) throw new Error("The Leads board id is not set in the-ceo/config.toml.");
            return (await queryAll(boards.leads, key)).map((p): LeadRow => fromNotion(p.properties ?? {}, String(p.last_edited_time ?? "")));
          })();
    const [tasks, leads] = await Promise.all([portalTasks(src.url, portalKeyText, now), leadsP]);
    for (const at of tasks.done) {
      const w = weekIndex(at, now);
      if (w >= 0) weeks[w].tasksDone++;
    }
    for (const l of leads) {
      if (!ANSWERED.has(l.result)) continue;
      const w = weekIndex(l.resultDate || l.edited, now);
      if (w >= 0) weeks[w].leadsAnswered++;
    }
    const data: CeoMeasure = { ok: true, reason: "", weeks, openTasks: tasks.open, tasksSource: "the team portal" };
    g.__ceoMeasure = { at: now, data };
    return data;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err), weeks: [], openTasks: 0 };
  }
}
