// Companies, their people and their Notion connection. Every read takes a tenantId first, so a query cannot reach
// another company's rows by forgetting a filter.
import { readFileSync } from "node:fs";
import { and, eq, gte, isNull } from "drizzle-orm";
import { decrypt, encrypt } from "./crypto";
import type { Db } from "./db";
import { boardRows, notionConnections, outcomes, shifts, tenants, users, type TenantSettings } from "./db/schema";
import type { Role } from "./roles";

export async function createTenant(db: Db, name: string, slug: string, owner: { email: string; name: string }) {
  const [t] = await db.insert(tenants).values({ name, slug }).returning();
  const [u] = await db.insert(users).values({ tenantId: t.id, email: owner.email.toLowerCase(), name: owner.name, role: "owner" }).returning();
  return { tenant: t, owner: u };
}

export async function addUser(db: Db, tenantId: string, email: string, name: string, role: Exclude<Role, "owner"> = "member") {
  const [u] = await db.insert(users).values({ tenantId, email: email.toLowerCase(), name, role }).returning();
  return u;
}

export async function userByEmail(db: Db, tenantId: string, email: string) {
  const [u] = await db.select().from(users).where(and(eq(users.tenantId, tenantId), eq(users.email, email.toLowerCase())));
  return u ?? null;
}

export async function settingsOf(db: Db, tenantId: string): Promise<TenantSettings> {
  const [t] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  return t?.settings ?? {};
}

/** Store a tenant's Notion integration; the token is encrypted before it reaches the database. Board titles are kept so
 *  Settings can name the boards without asking Notion again. */
export async function connectNotion(
  db: Db,
  tenantId: string,
  token: string,
  leads: string | { id: string; title: string },
  tasks?: string | { id: string; title: string } | null,
  integrationName?: string,
) {
  const l = typeof leads === "string" ? { id: leads, title: null } : { id: leads.id, title: leads.title || null };
  const t = !tasks ? null : typeof tasks === "string" ? { id: tasks, title: null } : { id: tasks.id, title: tasks.title || null };
  const values = { tenantId, tokenEncrypted: encrypt(token), leadsDataSource: l.id, leadsTitle: l.title, tasksDataSource: t?.id ?? null, tasksTitle: t?.title ?? null, integrationName: integrationName ?? null };
  // A different Leads board makes the cached rows another board's: they go.
  const before = await db.select({ leads: notionConnections.leadsDataSource }).from(notionConnections).where(eq(notionConnections.tenantId, tenantId));
  if (before[0] && before[0].leads !== l.id) await db.delete(boardRows).where(eq(boardRows.tenantId, tenantId));
  await db.insert(notionConnections).values(values).onConflictDoUpdate({ target: notionConnections.tenantId, set: values });
}

export type NotionConnection = {
  token: string;
  leads: string;
  tasks: string | null;
  leadsTitle: string | null;
  tasksTitle: string | null;
  integrationName: string | null;
  since: Date;
  /** Development only: the token came from NOTION_TOKEN_FILE, not from Settings. */
  fromDevFile: boolean;
};

export async function notionOf(db: Db, tenantId: string): Promise<NotionConnection | null> {
  let [c] = await db.select().from(notionConnections).where(eq(notionConnections.tenantId, tenantId));
  const dev = devNotion();
  if (dev && (!c || decrypt(c.tokenEncrypted) !== dev.token)) {
    // Development on the owner's Mac: the token file wins over whatever was pasted; the boards chosen stay.
    const leads = c ? { id: c.leadsDataSource, title: c.leadsTitle ?? "" } : dev.leads;
    const tasks = c ? (c.tasksDataSource ? { id: c.tasksDataSource, title: c.tasksTitle ?? "" } : null) : dev.tasks;
    await connectNotion(db, tenantId, dev.token, leads, tasks, "NOTION_TOKEN_FILE (dev)");
    [c] = await db.select().from(notionConnections).where(eq(notionConnections.tenantId, tenantId));
  }
  if (!c) return null;
  return {
    token: decrypt(c.tokenEncrypted),
    leads: c.leadsDataSource,
    tasks: c.tasksDataSource,
    leadsTitle: c.leadsTitle,
    tasksTitle: c.tasksTitle,
    integrationName: c.integrationName,
    since: c.createdAt,
    fromDevFile: !!dev,
  };
}

/** NOTION_TOKEN_FILE + NOTION_LEADS_DATA_SOURCE (and NOTION_TASKS_DATA_SOURCE), outside production only: the owner's
 *  own token on their own Mac, so local work needs no paste. Never read in a production build. */
function devNotion(): { token: string; leads: string; tasks: string | null } | null {
  const file = process.env.NOTION_TOKEN_FILE?.trim();
  const leads = process.env.NOTION_LEADS_DATA_SOURCE?.trim();
  if (process.env.NODE_ENV === "production" || !file || !leads) return null;
  try {
    const token = readFileSync(file, "utf8").replace(/\s+/g, "");
    return token ? { token, leads, tasks: process.env.NOTION_TASKS_DATA_SOURCE?.trim() || null } : null;
  } catch {
    return null;
  }
}

/** Board titles found later (a connection made before titles were kept, or by the dev token file). */
export async function nameBoards(db: Db, tenantId: string, leadsTitle: string | null, tasksTitle: string | null) {
  await db.update(notionConnections).set({ leadsTitle, tasksTitle }).where(eq(notionConnections.tenantId, tenantId));
}

/** Forget the company's Notion: the stored token and every cached row. The board in Notion is not touched. */
export async function disconnectNotion(db: Db, tenantId: string) {
  await db.delete(boardRows).where(eq(boardRows.tenantId, tenantId));
  await db.delete(notionConnections).where(eq(notionConnections.tenantId, tenantId));
}

/** When the board was last read and the cached rows, for the Settings card; no call to Notion. */
export async function cachedBoard(db: Db, tenantId: string) {
  const rows = await db.select({ data: boardRows.data, fetchedAt: boardRows.fetchedAt }).from(boardRows).where(eq(boardRows.tenantId, tenantId));
  const last = rows.reduce<Date | null>((m, r) => (!m || r.fetchedAt > m ? r.fetchedAt : m), null);
  return { rows: rows.map((r) => r.data), lastRefresh: last };
}

// ---- the clock -------------------------------------------------------------------------------------------------

export async function shiftsSince(db: Db, tenantId: string, userId: string, since: Date) {
  return db.select().from(shifts).where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), gte(shifts.startedAt, since)));
}

/** Clock in to a project (null is General; the caller checks the project is the company's and active). */
export async function clockIn(db: Db, tenantId: string, userId: string, at = new Date(), projectId: string | null = null) {
  const open = await db.select().from(shifts).where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), isNull(shifts.endedAt)));
  if (open.length) return { ok: false as const, reason: "already clocked in" };
  const [s] = await db.insert(shifts).values({ tenantId, userId, startedAt: at, projectId }).returning();
  return { ok: true as const, shift: s };
}

/** Switch project mid-day: the open shift closes and a new one opens on the other project at the same moment, so the
 *  day has no gap. Switching to the project already running does nothing. */
export async function switchProject(db: Db, tenantId: string, userId: string, projectId: string | null, at = new Date()) {
  return db.transaction(async (tx) => {
    const [open] = await tx.select().from(shifts).where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), isNull(shifts.endedAt)));
    if (!open) return { ok: false as const, reason: "not clocked in" };
    if ((open.projectId ?? null) === projectId) return { ok: true as const, shift: open };
    await tx.update(shifts).set({ endedAt: at }).where(eq(shifts.id, open.id));
    const [s] = await tx.insert(shifts).values({ tenantId, userId, startedAt: at, projectId }).returning();
    return { ok: true as const, shift: s };
  });
}

export async function clockOut(db: Db, tenantId: string, userId: string, at = new Date(), note = "") {
  const [s] = await db
    .update(shifts)
    .set({ endedAt: at, note })
    .where(and(eq(shifts.tenantId, tenantId), eq(shifts.userId, userId), isNull(shifts.endedAt)))
    .returning();
  return s ? { ok: true as const, shift: s } : { ok: false as const, reason: "not clocked in" };
}

export async function recordOutcome(db: Db, tenantId: string, userId: string | null, pageId: string, kind: "reviewed" | "sent") {
  await db.insert(outcomes).values({ tenantId, userId, pageId, kind });
}
