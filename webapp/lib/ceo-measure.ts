// Server-side only: how The CEO is measured: per week, (1) tasks on the team's task board
// that a person moved to Done, and (2) leads whose Result reached Replied, Meeting or Client. Tasks created is not a
// measure. The tasks are the local board's or the team portal's: a task counts in the week of its newest step to Done
// made by a person, from its History. A lead's week is
// its Result date, else its last edit. Four weeks, newest first; cached 10 minutes.
import { readFile } from "node:fs/promises";
import { CLOSED_TASK, doneByPerson, weekIndex, type PortalTask, type TaskStep } from "./checks";
import { fromPortal } from "./lead-rows";
import { localTasksMeasure } from "./local-board";
import { boardLeads, leadsSource, portalKey } from "./portal";

const ANSWERED = new Set(["Replied", "Meeting", "Client"]);

export type CeoWeek = { from: string; tasksDone: number; leadsAnswered: number };
export type CeoMeasure = { ok: boolean; reason: string; weeks: CeoWeek[]; openTasks: number; tasksSource?: string };

const g = globalThis as { __ceoMeasure?: { at: number; data: CeoMeasure } };

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
    let tasksP: Promise<{ open: number; done: string[] }>;
    if (src.store === "local") tasksP = Promise.resolve(localTasksMeasure(CLOSED_TASK));
    else {
      const portalKeyText = (await readFile(/*turbopackIgnore: true*/ portalKey(), "utf8").catch(() => "")).trim();
      if (!portalKeyText) return { ok: false, reason: "source not connected: no team portal key for the dashboard (common-data/keys/portal-dashboard.key)", weeks: [], openTasks: 0 };
      tasksP = portalTasks(src.url, portalKeyText, now);
    }
    const [tasks, leads] = await Promise.all([tasksP, boardLeads().then((ls) => ls.map(fromPortal))]);
    for (const at of tasks.done) {
      const w = weekIndex(at, now);
      if (w >= 0) weeks[w].tasksDone++;
    }
    for (const l of leads) {
      if (!ANSWERED.has(l.result)) continue;
      const w = weekIndex(l.resultDate || l.edited, now);
      if (w >= 0) weeks[w].leadsAnswered++;
    }
    const data: CeoMeasure = { ok: true, reason: "", weeks, openTasks: tasks.open, tasksSource: src.store === "local" ? "the Tasks board" : "the team portal" };
    g.__ceoMeasure = { at: now, data };
    return data;
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err), weeks: [], openTasks: 0 };
  }
}
