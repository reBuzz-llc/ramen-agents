// The projects a company's people clock in to. "General" is every company's default and is not stored: a shift with no
// project is General. Anyone can create a project from the clock; owner and managers rename, archive and merge them in
// Settings. An archived project is out of the picker but keeps its past hours.
import { and, asc, desc, eq, gte, isNotNull } from "drizzle-orm";
import type { Db } from "./db";
import { withChange } from "./cadence";
import { projects, shifts } from "./db/schema";
import { GENERAL, type Project } from "./project-picker";

export { GENERAL, pickerOptions, type PickerOption, type Project } from "./project-picker";

export async function projectsOf(db: Db, tenantId: string): Promise<Project[]> {
  return db
    .select({ id: projects.id, name: projects.name, client: projects.client, active: projects.active, cadenceHistory: projects.cadenceHistory })
    .from(projects)
    .where(eq(projects.tenantId, tenantId))
    .orderBy(desc(projects.active), asc(projects.name));
}

export async function addProject(db: Db, tenantId: string, name: string, client = "", createdBy: string | null = null) {
  const n = name.trim().slice(0, 80);
  if (!n || n.toLowerCase() === GENERAL.toLowerCase()) return { ok: false as const, error: `"${GENERAL}" is built in; give the project another name.` };
  const [p] = await db.insert(projects).values({ tenantId, name: n, client: client.trim().slice(0, 80), createdBy }).onConflictDoNothing().returning();
  return p ? { ok: true as const, project: p } : { ok: false as const, error: `There is already a project called "${n}".` };
}

/** A project's update cadence from now on (null = the company default); the window under way keeps its length. */
export async function setProjectCadence(db: Db, tenantId: string, id: string, minutes: number | null, at = new Date()) {
  const [p] = await db.select({ h: projects.cadenceHistory }).from(projects).where(and(eq(projects.tenantId, tenantId), eq(projects.id, id)));
  if (!p) return false;
  await db.update(projects).set({ cadenceHistory: withChange(p.h, minutes, at) }).where(and(eq(projects.tenantId, tenantId), eq(projects.id, id)));
  return true;
}

export async function setProjectActive(db: Db, tenantId: string, id: string, active: boolean) {
  await db.update(projects).set({ active }).where(and(eq(projects.tenantId, tenantId), eq(projects.id, id)));
}

/** A project id a person may clock in to: null (General), or an active project of their own company. */
export async function usableProject(db: Db, tenantId: string, id: string | null | undefined): Promise<string | null | undefined> {
  if (!id) return null;
  const [p] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.tenantId, tenantId), eq(projects.id, id), eq(projects.active, true)));
  return p ? p.id : undefined; // undefined: not usable
}

/** The project of a person's most recent shift, so the clock remembers their last choice; null is General. */
export async function lastProject(db: Db, tenantId: string, userId: string): Promise<string | null> {
  const [s] = await db
    .select({ projectId: shifts.projectId })
    .from(shifts)
    .where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), isNotNull(shifts.startedAt)))
    .orderBy(desc(shifts.startedAt))
    .limit(1);
  return s?.projectId ?? null;
}

/** "Project name" for an id, General for null, "(removed project)" for an id no longer listed. */
export const projectName = (list: Project[], id: string | null) => (id === null ? GENERAL : (list.find((p) => p.id === id)?.name ?? "(removed project)"));

/** A person's projects of the last two weeks, most recent first (null is General): the top of their picker. */
export async function recentProjects(db: Db, tenantId: string, userId: string, days = 14): Promise<(string | null)[]> {
  const rows = await db
    .select({ projectId: shifts.projectId, startedAt: shifts.startedAt })
    .from(shifts)
    .where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), gte(shifts.startedAt, new Date(Date.now() - days * 86400e3))))
    .orderBy(desc(shifts.startedAt))
    .limit(200);
  return [...new Set(rows.map((r) => r.projectId ?? null))];
}

export async function renameProject(db: Db, tenantId: string, id: string, name: string) {
  const n = name.trim().slice(0, 80);
  if (!n || n.toLowerCase() === GENERAL.toLowerCase()) return { ok: false as const, error: "Give the project a name other than General." };
  try {
    await db.update(projects).set({ name: n }).where(and(eq(projects.tenantId, tenantId), eq(projects.id, id)));
    return { ok: true as const };
  } catch {
    return { ok: false as const, error: `There is already a project called "${n}".` };
  }
}

/** Merge one project into another (or into General): its hours move over, then it is removed. For duplicates such as
 *  "Website" and "website redo" made from the clock. */
export async function mergeProjects(db: Db, tenantId: string, fromId: string, intoId: string | null) {
  if (fromId === intoId) return { ok: false as const, error: "Pick two different projects." };
  return db.transaction(async (tx) => {
    const [from] = await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.tenantId, tenantId), eq(projects.id, fromId)));
    const into = intoId ? (await tx.select({ id: projects.id }).from(projects).where(and(eq(projects.tenantId, tenantId), eq(projects.id, intoId))))[0] : { id: null };
    if (!from || !into) return { ok: false as const, error: "That project is not in your company." };
    await tx.update(shifts).set({ projectId: into.id }).where(and(eq(shifts.tenantId, tenantId), eq(shifts.projectId, fromId)));
    await tx.delete(projects).where(eq(projects.id, fromId));
    return { ok: true as const };
  });
}

/** Fix the project of one of your own shifts from today (picked the wrong one). Times are not edited here. */
export async function setShiftProject(db: Db, tenantId: string, userId: string, shiftId: string, projectId: string | null, today: Date) {
  if (!/^[0-9a-f-]{36}$/i.test(shiftId)) return { ok: false as const, reason: "No such shift." };
  const [s] = await db.select().from(shifts).where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), eq(shifts.id, shiftId)));
  if (!s) return { ok: false as const, reason: "No such shift." };
  if (s.startedAt < today) return { ok: false as const, reason: "Only today's shifts can be changed here." };
  await db.update(shifts).set({ projectId }).where(eq(shifts.id, s.id));
  return { ok: true as const };
}
