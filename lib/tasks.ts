// The team's tasks in Peek's own database. Every
// write goes through writeTask, which keeps the board's rules and records each cell in task_cells, as leads do:
// - person wins: a bot never replaces a field whose last change was a person's; the attempt is kept, refused;
// - human only: status, assignees and the checklist's ticks are the team's. A bot may create a task (it starts "Not
//   started", nobody assigned), append to its details, and add unticked checklist items, never tick or untick one;
// - an import (the backfill's key) copies Notion as it is, past those rules, and is idempotent on the Notion page id.
// Readers follow `rev`: listTasks(since = the last rev seen) returns what changed after it, in order.
import { and, asc, desc, eq, gt, sql } from "drizzle-orm";
import type { Db } from "./db";
import { taskCells, taskFlags, tasks } from "./db/schema";
import type { Actor } from "./leads";

/** Notion's Status options, spelling kept ("Not Fisible", "Dublicate"). */
export const TASK_STATUSES = ["Not started", "In progress", "In Review", "Done", "Blocker", "QA", "Not Fisible", "Dublicate"] as const;
/** The queue's steps; the others are set from the task's menu. */
export { STEPS } from "./task-steps";
export const CLOSED = new Set(["Done", "Not Fisible", "Dublicate"]);
export const PRIORITIES = ["P0", "P1", "P2", "P3", "P4", "P5", "P6", "Medium"] as const;

type Kind = "text" | "list" | "date" | "bool" | "checklist" | "status" | "priority";
type Prop = keyof typeof tasks.$inferSelect;
type Field = { key: string; prop: Prop; kind: Kind; human?: boolean };
export type CheckItem = { text: string; done: boolean };

export const TASK_FIELDS: Field[] = [
  { key: "title", prop: "title", kind: "text" },
  { key: "status", prop: "status", kind: "status", human: true },
  { key: "priority", prop: "priority", kind: "priority" },
  { key: "assignees", prop: "assignees", kind: "list", human: true },
  { key: "due", prop: "due", kind: "date" },
  { key: "projects", prop: "projects", kind: "list" },
  { key: "blocker", prop: "blocker", kind: "text" },
  { key: "files", prop: "files", kind: "list" },
  { key: "details", prop: "details", kind: "text" },
  { key: "checklist", prop: "checklist", kind: "checklist", human: true },
  { key: "standing", prop: "standing", kind: "bool" },
  { key: "archived", prop: "archived", kind: "bool", human: true },
  { key: "notion_url", prop: "notionUrl", kind: "text" },
  { key: "notion_uid", prop: "notionUid", kind: "text" },
];
const BY_KEY = new Map(TASK_FIELDS.map((f) => [f.key, f]));
const MAX_TEXT = 50_000;
export const MAX_BATCH = 100;

export type Task = Record<string, unknown> & { id: string; rev: number };
export type TaskRefusal = { field: string; reason: "person_wins" | "human_only"; current: unknown };
export type TaskWrite =
  | { ok: true; created: boolean; task: Task; written: string[]; refused: TaskRefusal[] }
  | { ok: false; code: "not_found" | "bad_request"; message: string };

function normalise(f: Field, v: unknown): { value: unknown } | { error: string } {
  if (f.kind === "bool") return typeof v === "boolean" ? { value: v } : v === null || v === undefined ? { value: false } : { error: `${f.key} is true or false` };
  if (v === null || v === undefined || v === "") return { value: null };
  if (f.kind === "text") {
    if (typeof v !== "string" && typeof v !== "number") return { error: `${f.key} is text` };
    const s = String(v).trim();
    return s.length > MAX_TEXT ? { error: `${f.key} is longer than ${MAX_TEXT} characters` } : { value: s || null };
  }
  if (f.kind === "status") return (TASK_STATUSES as readonly string[]).includes(String(v)) ? { value: String(v) } : { error: `status is one of: ${TASK_STATUSES.join(", ")}` };
  if (f.kind === "priority") return (PRIORITIES as readonly string[]).includes(String(v)) ? { value: String(v) } : { error: `priority is one of: ${PRIORITIES.join(", ")}` };
  if (f.kind === "list") {
    const arr = Array.isArray(v) ? v : String(v).split(",");
    const items = arr.map((x) => String(x ?? "").trim()).filter(Boolean);
    return { value: items.length ? items : null };
  }
  if (f.kind === "checklist") {
    if (!Array.isArray(v)) return { error: "checklist is a list of {text, done}" };
    const items: CheckItem[] = [];
    for (const x of v) {
      if (!x || typeof x !== "object" || typeof (x as CheckItem).text !== "string") return { error: "checklist is a list of {text, done}" };
      const text = (x as CheckItem).text.trim().slice(0, 2000);
      if (text) items.push({ text, done: (x as CheckItem).done === true });
    }
    return { value: items.length ? items : null };
  }
  const d = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(Date.parse(d)) ? { value: d } : { error: `${f.key} is a date (YYYY-MM-DD)` };
}

// Key order does not count: jsonb hands {text, done} back as {done, text}.
const canon = (v: unknown): string => (Array.isArray(v) ? `[${v.map(canon).join(",")}]` : v && typeof v === "object" ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon((v as Record<string, unknown>)[k])}`).join(",")}}` : JSON.stringify(v ?? null));
const same = (a: unknown, b: unknown) => canon(a) === canon(b);

/** A bot's checklist write is allowed when it keeps every item as it is (text and tick, in order) and only adds
 *  unticked ones after them: the Done-when list grows, the team's ticks never move. */
export const onlyAdds = (old: CheckItem[] | null, next: CheckItem[] | null) => {
  const a = old ?? [];
  const b = next ?? [];
  return b.length >= a.length && a.every((x, i) => b[i].text === x.text && b[i].done === x.done) && b.slice(a.length).every((x) => !x.done);
};

export function toApi(r: typeof tasks.$inferSelect): Task {
  const out: Task = { id: r.id, notion_page_id: r.notionPageId, rev: Number(r.rev) };
  for (const f of TASK_FIELDS) out[f.key] = r[f.prop] ?? null;
  Object.assign(out, {
    created_by: r.createdBy,
    created_at: r.createdAt.toISOString(),
    updated_at: r.updatedAt.toISOString(),
    last_edited_by: r.lastActorName ? { actor: r.lastActorName, kind: r.lastActorKind } : null,
  });
  return out;
}

/**
 * Write one task: an update to the task found by `target`, or, when there is none and `create` is set, a new one.
 * `detailsAppend` adds a paragraph to the details (a bot's way to add to what a person wrote).
 */
export async function writeTask(
  db: Db,
  tenantId: string,
  target: { id?: string; notionPageId?: string },
  input: Record<string, unknown>,
  actor: Actor,
  opts: { create?: boolean; import?: boolean; detailsAppend?: string } = {},
): Promise<TaskWrite> {
  const want = new Map<Field, unknown>();
  for (const [k, v] of Object.entries(input)) {
    if (["id", "notion_page_id", "rev", "created_at", "created_by", "updated_at", "last_edited_by"].includes(k)) continue;
    const f = BY_KEY.get(k);
    if (!f) return { ok: false, code: "bad_request", message: `unknown field: ${k}` };
    const n = normalise(f, v);
    if ("error" in n) return { ok: false, code: "bad_request", message: n.error };
    want.set(f, n.value);
  }
  const append = typeof opts.detailsAppend === "string" ? opts.detailsAppend.trim().slice(0, MAX_TEXT) : "";
  const createdAt = opts.import && typeof input.created_at === "string" && !Number.isNaN(Date.parse(input.created_at)) ? new Date(input.created_at) : null;
  if (!target.id && !target.notionPageId && !opts.create) return { ok: false, code: "bad_request", message: "a task is named by its id or its notion_page_id" };
  if (target.id && !/^[0-9a-f-]{36}$/i.test(target.id)) return { ok: false, code: "not_found", message: `no task ${target.id}` };
  const isBot = actor.kind === "bot" && !opts.import;

  return db.transaction(async (tx) => {
    const where = target.id ? eq(tasks.id, target.id) : target.notionPageId ? eq(tasks.notionPageId, target.notionPageId) : null;
    const [cur] = where ? await tx.select().from(tasks).where(and(eq(tasks.tenantId, tenantId), where)).for("update") : [];
    const now = new Date();
    const who = { actorKind: actor.kind, actorName: actor.name.slice(0, 80), actorUserId: actor.kind === "person" ? actor.userId : null, via: actor.kind === "bot" ? actor.via : null };
    const history: (typeof taskCells.$inferInsert)[] = [];
    const refused: TaskRefusal[] = [];

    if (!cur) {
      if (!opts.create) return { ok: false as const, code: "not_found" as const, message: `no task ${target.id ?? target.notionPageId}` };
      const title = want.get(BY_KEY.get("title")!);
      if (!title) return { ok: false as const, code: "bad_request" as const, message: "a new task needs a title" };
      const values: Record<string, unknown> = {};
      for (const [f, v] of want) {
        if (v === null) continue;
        // A bot's new task starts unassigned and "Not started"; its checklist is the Done-when list, unticked.
        const botOk = f.key === "status" ? v === "Not started" : f.key === "checklist" ? onlyAdds(null, v as CheckItem[]) : !f.human;
        if (isBot && !botOk) {
          refused.push({ field: f.key, reason: "human_only", current: null });
          continue;
        }
        values[f.prop] = v;
      }
      if (append) values.details = values.details ? `${values.details}\n\n${append}` : append;
      const [row] = await tx
        .insert(tasks)
        .values({
          ...(values as Partial<typeof tasks.$inferInsert>),
          title: String(values.title),
          tenantId,
          notionPageId: target.notionPageId ?? null,
          createdBy: who.actorName,
          lastActorName: who.actorName,
          lastActorKind: who.actorKind,
          ...(createdAt ? { createdAt } : {}),
        })
        .returning();
      for (const f of TASK_FIELDS) if (values[f.prop] !== undefined) history.push({ tenantId, taskId: row.id, column: f.key, old: null, new: values[f.prop] as object, ...who });
      for (const r of refused) history.push({ tenantId, taskId: row.id, column: r.field, old: null, new: want.get(BY_KEY.get(r.field)!) as object, ...who, outcome: "refused", reason: r.reason });
      if (history.length) await tx.insert(taskCells).values(history);
      return { ok: true as const, created: true, task: toApi(row), written: Object.keys(values).map((p) => TASK_FIELDS.find((f) => f.prop === p)!.key), refused };
    }

    const lastBy = new Map<string, string>();
    if (isBot) {
      const past = await tx
        .select({ column: taskCells.column, kind: taskCells.actorKind })
        .from(taskCells)
        // a bot's append adds to the details without taking them over from the person who wrote them
        .where(and(eq(taskCells.taskId, cur.id), eq(taskCells.outcome, "applied"), sql`${taskCells.reason} is distinct from 'append'`))
        .orderBy(desc(taskCells.id));
      for (const p of past) if (!lastBy.has(p.column)) lastBy.set(p.column, p.kind);
    }
    if (append) {
      const base = want.has(BY_KEY.get("details")!) ? (want.get(BY_KEY.get("details")!) as string | null) : cur.details;
      want.set(BY_KEY.get("details")!, base ? `${base}\n\n${append}` : append);
    }
    const set: Record<string, unknown> = {};
    const written: string[] = [];
    for (const [f, v] of want) {
      const old = cur[f.prop] ?? null;
      if (same(old, v)) continue;
      let reason: TaskRefusal["reason"] | null = null;
      if (isBot) {
        const appendOnly = f.key === "details" && !!append && !("details" in input);
        if (f.key === "checklist") reason = onlyAdds(old as CheckItem[] | null, v as CheckItem[] | null) ? null : "human_only";
        else if (f.human) reason = "human_only";
        else if (!appendOnly && lastBy.get(f.key) === "person") reason = "person_wins";
      }
      if (reason) {
        refused.push({ field: f.key, reason, current: old });
        history.push({ tenantId, taskId: cur.id, column: f.key, old: old as object, new: v as object, ...who, outcome: "refused", reason });
        continue;
      }
      set[f.prop] = v;
      written.push(f.key);
      history.push({ tenantId, taskId: cur.id, column: f.key, old: old as object, new: v as object, ...who, ...(f.key === "details" && append && !("details" in input) ? { reason: "append" } : {}) });
    }
    if (createdAt && cur.createdAt.getTime() !== createdAt.getTime()) set.createdAt = createdAt;
    if (!Object.keys(set).length) {
      if (history.length) await tx.insert(taskCells).values(history);
      return { ok: true as const, created: false, task: toApi(cur), written, refused };
    }
    const [row] = await tx
      .update(tasks)
      .set({ ...(set as Partial<typeof tasks.$inferInsert>), updatedAt: now, rev: sql`nextval('tasks_rev_seq')`, lastActorName: who.actorName, lastActorKind: who.actorKind })
      .where(eq(tasks.id, cur.id))
      .returning();
    if (history.length) await tx.insert(taskCells).values(history);
    return { ok: true as const, created: false, task: toApi(row), written, refused };
  });
}

/** Tasks in `rev` order after `since` (0 for all): {tasks, next, more}, as listLeads. Archived ones only when asked. */
export async function listTasks(db: Db, tenantId: string, q: { since?: number; limit?: number; archived?: boolean; status?: string } = {}) {
  const limit = Math.min(Math.max(Math.floor(q.limit ?? 100), 1), 500);
  const since = Math.max(Math.floor(q.since ?? 0), 0);
  const where = [eq(tasks.tenantId, tenantId), gt(tasks.rev, since)];
  if (!q.archived) where.push(eq(tasks.archived, false));
  if (q.status) where.push(eq(tasks.status, q.status));
  const rows = await db.select().from(tasks).where(and(...where)).orderBy(asc(tasks.rev)).limit(limit + 1);
  const page = rows.slice(0, limit);
  return { tasks: page.map(toApi), next: page.length ? Number(page[page.length - 1].rev) : since, more: rows.length > limit };
}

export async function getTask(db: Db, tenantId: string, target: { id?: string; notionPageId?: string }) {
  if (target.id && !/^[0-9a-f-]{36}$/i.test(target.id)) return null;
  const where = target.id ? eq(tasks.id, target.id) : target.notionPageId ? eq(tasks.notionPageId, target.notionPageId) : null;
  if (!where) return null;
  const [r] = await db.select().from(tasks).where(and(eq(tasks.tenantId, tenantId), where));
  return r ? toApi(r) : null;
}

export async function taskHistory(db: Db, tenantId: string, taskId: string, limit = 500) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return [];
  const rows = await db
    .select()
    .from(taskCells)
    .where(and(eq(taskCells.tenantId, tenantId), eq(taskCells.taskId, taskId)))
    .orderBy(desc(taskCells.id))
    .limit(Math.min(limit, 2000));
  return rows.map((h) => ({ id: h.id, column: h.column, old: h.old, new: h.new, actor: { kind: h.actorKind, name: h.actorName, via: h.via }, at: h.at.toISOString(), outcome: h.outcome, reason: h.reason }));
}

/** Does this company keep its tasks in Peek yet? (Until the backfill, the queue still reads Notion's task board.) */
export async function hasTasks(db: Db, tenantId: string) {
  const [r] = await db.select({ id: tasks.id }).from(tasks).where(eq(tasks.tenantId, tenantId)).limit(1);
  return !!r;
}

// ---- the Validator's flags (the lead_flags contract) ---------------------------------------------------------------

export type TaskFlag = { id: string; rule: string; detail: string; status: "open" | "resolved"; first_seen: string; resolved_at: string | null; actor: string | null };
const flagShape = (f: typeof taskFlags.$inferSelect): TaskFlag => ({
  id: f.id,
  rule: f.rule,
  detail: f.detail,
  status: f.status === "resolved" ? "resolved" : "open",
  first_seen: f.firstSeen.toISOString(),
  resolved_at: f.resolvedAt?.toISOString() ?? null,
  actor: f.actor,
});
const taskOf = async (db: Db, tenantId: string, id: string) => (/^[0-9a-f-]{36}$/i.test(id) ? (await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.tenantId, tenantId), eq(tasks.id, id))))[0] : undefined);

export async function raiseTaskFlag(db: Db, tenantId: string, taskId: string, rule: string, detail: string, actor: string): Promise<TaskFlag | null> {
  if (!(await taskOf(db, tenantId, taskId))) return null;
  const r = rule.trim().slice(0, 80);
  const d = detail.trim().slice(0, 2000);
  const [f] = await db
    .insert(taskFlags)
    .values({ tenantId, taskId, rule: r, detail: d, actor })
    .onConflictDoUpdate({ target: [taskFlags.taskId, taskFlags.rule], set: { detail: d, status: "open", resolvedAt: null, actor } })
    .returning();
  return flagShape(f);
}

export async function resolveTaskFlag(db: Db, tenantId: string, taskId: string, flagId: string, actor: string): Promise<TaskFlag | null> {
  if (!/^[0-9a-f-]{36}$/i.test(flagId)) return null;
  const [f] = await db
    .update(taskFlags)
    .set({ status: "resolved", resolvedAt: new Date(), actor })
    .where(and(eq(taskFlags.tenantId, tenantId), eq(taskFlags.taskId, taskId), eq(taskFlags.id, flagId)))
    .returning();
  return f ? flagShape(f) : null;
}

export async function taskFlagsOf(db: Db, tenantId: string, taskId: string): Promise<TaskFlag[] | null> {
  if (!(await taskOf(db, tenantId, taskId))) return null;
  const rows = await db.select().from(taskFlags).where(and(eq(taskFlags.tenantId, tenantId), eq(taskFlags.taskId, taskId))).orderBy(asc(taskFlags.firstSeen));
  return rows.map(flagShape);
}

/** Open flags per task, for the queue's cards. */
export async function openTaskFlags(db: Db, tenantId: string): Promise<Map<string, { rule: string; detail: string }[]>> {
  const rows = await db.select().from(taskFlags).where(and(eq(taskFlags.tenantId, tenantId), eq(taskFlags.status, "open")));
  const m = new Map<string, { rule: string; detail: string }[]>();
  for (const f of rows) m.set(f.taskId, [...(m.get(f.taskId) ?? []), { rule: f.rule, detail: f.detail }]);
  return m;
}

// ---- a person's changes from the queue ------------------------------------------------------------------------------

export type PersonChange = { status?: string; tick?: { index: number; text: string; done: boolean }; assignees?: string[]; priority?: string | null; due?: string | null };

/** A person's change from the queue card: a status step (or back to "Not started"), one checklist tick (named by its
 *  place and text, so a list that changed meanwhile is never ticked in the wrong place), the assignees, the priority or
 *  the deadline. Written as the person through writeTask, so it lands in the history and wins over the bots. */
export async function changeTask(db: Db, tenantId: string, id: string, who: Extract<Actor, { kind: "person" }>, c: PersonChange): Promise<TaskWrite> {
  const fields: Record<string, unknown> = {};
  if (c.status !== undefined) fields.status = c.status || "Not started";
  if (c.assignees !== undefined) fields.assignees = c.assignees;
  if (c.priority !== undefined) fields.priority = c.priority;
  if (c.due !== undefined) fields.due = c.due;
  if (c.tick) {
    const cur = await getTask(db, tenantId, { id });
    if (!cur) return { ok: false, code: "not_found", message: `no task ${id}` };
    const list = ((cur.checklist as CheckItem[] | null) ?? []).map((x) => ({ text: x.text, done: x.done }));
    const item = list[c.tick.index];
    if (!item || item.text !== c.tick.text) return { ok: false, code: "bad_request", message: "That checklist changed meanwhile; reload the queue." };
    item.done = c.tick.done;
    fields.checklist = list;
  }
  if (!Object.keys(fields).length) return { ok: false, code: "bad_request", message: "nothing to change" };
  return writeTask(db, tenantId, { id }, fields, who);
}
