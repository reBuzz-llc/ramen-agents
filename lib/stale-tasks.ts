// The daily stale-task sweep: a task still "Not started" that a bot made,
// that no person has touched (no person's change in its history, nobody holding it) and that is older than 14 days is
// archived, with the line "archived <date>, owner: stale" added to its details, each change in task_cells as the owner's
// rule. The first run reaches back 7 days. A task with no history at all (the Notion era) is left
// alone: who made it is not known. One job_runs line per company and run, with the count: the job log.
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { Db } from "./db";
import { claims, jobRuns, taskCells, tasks, tenants } from "./db/schema";

export const STALE_JOB = "stale-tasks";
export const STALE_DAYS = 14;
export const FIRST_RUN_DAYS = 7;
const ACTOR = "Peek (stale tasks, owner's rule)";

/** The tasks the rule takes for one company, oldest first. */
export async function staleTasks(db: Db, tenantId: string, days: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - days * 86400e3);
  return db
    .select({ id: tasks.id, title: tasks.title, details: tasks.details, createdAt: tasks.createdAt })
    .from(tasks)
    .where(
      and(
        eq(tasks.tenantId, tenantId),
        eq(tasks.archived, false),
        eq(tasks.status, "Not started"),
        lt(tasks.createdAt, cutoff),
        // made by a bot: its first recorded change is a bot's
        sql`(select c.actor_kind from ${taskCells} c where c.task_id = ${tasks.id} and c.outcome = 'applied' order by c.id asc limit 1) = 'bot'`,
        // touched by no person: no person's change, nobody holding it
        sql`not exists (select 1 from ${taskCells} c where c.task_id = ${tasks.id} and c.actor_kind = 'person')`,
        sql`not exists (select 1 from ${claims} k where k.tenant_id = ${tasks.tenantId} and k.page_id = ${tasks.id}::text)`,
      ),
    )
    .orderBy(tasks.createdAt);
}

/** One run for every company: the first run of the job uses 7 days, every later one 14. Answers the count per company. */
export async function runStaleTasks(db: Db, now = new Date()): Promise<{ days: number; archived: Record<string, number> }> {
  const [prev] = await db.select({ id: jobRuns.id }).from(jobRuns).where(eq(jobRuns.job, STALE_JOB)).orderBy(desc(jobRuns.id)).limit(1);
  const days = prev ? STALE_DAYS : FIRST_RUN_DAYS;
  const stamp = now.toISOString().slice(0, 10);
  const note = `archived ${stamp}, owner: stale`;
  const archived: Record<string, number> = {};
  for (const t of await db.select({ id: tenants.id, slug: tenants.slug }).from(tenants)) {
    const list = await staleTasks(db, t.id, days, now);
    if (list.length) {
      await db.transaction(async (tx) => {
        const d = tx as unknown as Db;
        for (const task of list) {
          const details = task.details?.trim() ? `${task.details.trim()}\n\n${note}` : note;
          await d.update(tasks).set({ archived: true, details, updatedAt: now, rev: sql`nextval('tasks_rev_seq')`, lastActorName: ACTOR, lastActorKind: "bot" }).where(eq(tasks.id, task.id));
          await d.insert(taskCells).values([
            { tenantId: t.id, taskId: task.id, column: "archived", old: false as unknown as object, new: true as unknown as object, actorKind: "bot", actorName: ACTOR, via: STALE_JOB, at: now, reason: note },
            { tenantId: t.id, taskId: task.id, column: "details", old: (task.details ?? null) as unknown as object, new: details as unknown as object, actorKind: "bot", actorName: ACTOR, via: STALE_JOB, at: now },
          ]);
        }
      });
    }
    archived[t.slug] = list.length;
    await db.insert(jobRuns).values({ job: STALE_JOB, tenantId: t.id, at: now, count: list.length, detail: { days, ids: list.map((x) => x.id).slice(0, 500) } });
  }
  return { days, archived };
}
