// The team's files: what may be uploaded, who may change what, and the history of every action.
// The bytes live in storage (lib/storage.ts); these rows are the app's record. Everyone on the team uploads and attaches;
// renaming, retagging and deleting are for the owner and managers, and for the uploader on their own file.
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import type { Db } from "./db";
import { files, filesHistory, leadFiles, leads, users } from "./db/schema";
import type { Role } from "./roles";

export const MAX_BYTES = 25 * 1024 * 1024;
export const TYPES: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" };
export type Who = { userId: string; name: string; role: Role };
export type FileRow = typeof files.$inferSelect & { uploader: string; attachedTo: number };

const clean = (name: string) =>
  name
    .replace(/[\u0000-\u001f\\/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

/** May this person rename, retag or delete this file? The owner and managers any; the uploader their own. */
export const canChange = (who: Pick<Who, "userId" | "role">, f: { uploadedBy: string | null }) => who.role !== "member" || f.uploadedBy === who.userId;

async function log(db: Db, tenantId: string, fileId: string, action: string, who: Who, detail: Record<string, unknown> = {}) {
  await db.insert(filesHistory).values({ tenantId, fileId, action, detail, actorUserId: who.userId, actorName: who.name });
}

/** Start an upload: checks the type and size, makes the pending row and the storage key. */
export async function startUpload(db: Db, tenantId: string, who: Who, input: { name: string; size: number; type: string; tag?: string }) {
  const ext = TYPES[input.type];
  if (!ext) return { ok: false as const, error: "PDFs, PNG and JPG only." };
  if (!Number.isFinite(input.size) || input.size <= 0) return { ok: false as const, error: "That file is empty." };
  if (input.size > MAX_BYTES) return { ok: false as const, error: `That file is ${(input.size / 1048576).toFixed(1)} MB; the limit is 25 MB.` };
  let name = clean(input.name) || `file.${ext}`;
  if (!name.toLowerCase().endsWith(`.${ext}`) && !(ext === "jpg" && /\.jpe?g$/i.test(name))) name = `${name}.${ext}`;
  const id = randomUUID();
  const key = `${tenantId}/${id}.${ext}`;
  const [f] = await db.insert(files).values({ id, tenantId, key, name, size: Math.round(input.size), contentType: input.type, tag: clean(input.tag ?? "").slice(0, 60), uploadedBy: who.userId }).returning();
  return { ok: true as const, file: f };
}

/** The bytes arrived: the stored size (null: nothing there) makes the file ready, or the pending row goes. */
export async function finishUpload(db: Db, tenantId: string, id: string, who: Who, storedSize: number | null) {
  const [f] = await db.select().from(files).where(and(eq(files.tenantId, tenantId), eq(files.id, id)));
  if (!f || f.status !== "pending" || f.uploadedBy !== who.userId) return { ok: false as const, error: "No upload of yours is waiting under that id." };
  if (storedSize === null || storedSize <= 0 || storedSize > MAX_BYTES) {
    await db.delete(files).where(eq(files.id, f.id));
    return { ok: false as const, error: storedSize === null ? "The upload did not arrive; try again." : "That file is over 25 MB." };
  }
  const [ready] = await db.update(files).set({ status: "ready", size: storedSize }).where(eq(files.id, f.id)).returning();
  await log(db, tenantId, f.id, "upload", who, { name: f.name, size: storedSize, tag: f.tag });
  return { ok: true as const, file: ready };
}

/** The company's ready files, newest first, with the uploader's name and how many leads each is attached to. */
export async function listFiles(db: Db, tenantId: string): Promise<FileRow[]> {
  const rows = await db
    .select({
      f: files,
      uploader: sql<string>`coalesce(nullif(${users.name}, ''), ${users.email}, '')`,
      attachedTo: sql<number>`(select count(*)::int from ${leadFiles} lf where lf.file_id = ${files.id})`,
    })
    .from(files)
    .leftJoin(users, eq(users.id, files.uploadedBy))
    .where(and(eq(files.tenantId, tenantId), eq(files.status, "ready"), isNull(files.deletedAt)))
    .orderBy(desc(files.createdAt));
  return rows.map((r) => ({ ...r.f, uploader: r.uploader ?? "", attachedTo: Number(r.attachedTo ?? 0) }));
}

export async function getFile(db: Db, tenantId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [f] = await db.select().from(files).where(and(eq(files.tenantId, tenantId), eq(files.id, id), isNull(files.deletedAt)));
  return f ?? null;
}

/** Rename or retag (the owner, managers, the uploader). */
export async function changeFile(db: Db, tenantId: string, id: string, who: Who, change: { name?: string; tag?: string }) {
  const f = await getFile(db, tenantId, id);
  if (!f || f.status !== "ready") return { ok: false as const, error: "No such file." };
  if (!canChange(who, f)) return { ok: false as const, error: "Only the owner, a manager or the person who uploaded it can change it." };
  const set: Partial<typeof files.$inferInsert> = {};
  if (change.name !== undefined) {
    const name = clean(change.name);
    if (!name) return { ok: false as const, error: "A file needs a name." };
    set.name = name;
  }
  if (change.tag !== undefined) set.tag = clean(change.tag).slice(0, 60);
  if (!Object.keys(set).length) return { ok: true as const, file: f };
  const [row] = await db.update(files).set(set).where(eq(files.id, f.id)).returning();
  if (set.name !== undefined && set.name !== f.name) await log(db, tenantId, f.id, "rename", who, { from: f.name, to: set.name });
  if (set.tag !== undefined && set.tag !== f.tag) await log(db, tenantId, f.id, "tag", who, { from: f.tag, to: set.tag });
  return { ok: true as const, file: row };
}

/** Delete (the owner, managers, the uploader): the caller removes the object; the row keeps its name for the history,
 *  and it comes off every lead it was attached to. */
export async function deleteFile(db: Db, tenantId: string, id: string, who: Who) {
  const f = await getFile(db, tenantId, id);
  if (!f) return { ok: false as const, error: "No such file." };
  if (!canChange(who, f)) return { ok: false as const, error: "Only the owner, a manager or the person who uploaded it can delete it." };
  await db.update(files).set({ deletedAt: new Date() }).where(eq(files.id, f.id));
  await db.delete(leadFiles).where(eq(leadFiles.fileId, f.id));
  await log(db, tenantId, f.id, "delete", who, { name: f.name });
  return { ok: true as const, key: f.key };
}

/** Attach a file to a lead's email, or take it off; anyone on the team; recorded in the file's history. */
export async function setAttached(db: Db, tenantId: string, leadId: string, fileId: string, who: Who, on: boolean) {
  const f = await getFile(db, tenantId, fileId);
  if (!f || f.status !== "ready") return { ok: false as const, error: "No such file." };
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return { ok: false as const, error: "No such lead." };
  const [l] = await db.select({ id: leads.id, business: leads.business }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
  if (!l) return { ok: false as const, error: "No such lead." };
  if (on) {
    const added = await db.insert(leadFiles).values({ tenantId, leadId, fileId, attachedBy: who.userId }).onConflictDoNothing().returning();
    if (added.length) await log(db, tenantId, fileId, "attach", who, { leadId, business: l.business });
  } else {
    const gone = await db.delete(leadFiles).where(and(eq(leadFiles.leadId, leadId), eq(leadFiles.fileId, fileId))).returning();
    if (gone.length) await log(db, tenantId, fileId, "detach", who, { leadId, business: l.business });
  }
  return { ok: true as const };
}

/** The files attached to a lead, in the order they were attached. */
export async function filesOfLead(db: Db, tenantId: string, leadId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return [];
  return db
    .select({ id: files.id, name: files.name, contentType: files.contentType, size: files.size })
    .from(leadFiles)
    .innerJoin(files, eq(files.id, leadFiles.fileId))
    .where(and(eq(leadFiles.tenantId, tenantId), eq(leadFiles.leadId, leadId), isNull(files.deletedAt)))
    .orderBy(leadFiles.at);
}

/** How many files each of these leads has attached (the Send next tab's paperclip). */
export async function attachmentCounts(db: Db, tenantId: string, leadIds: string[]): Promise<Map<string, number>> {
  if (!leadIds.length) return new Map();
  const rows = await db
    .select({ leadId: leadFiles.leadId, n: sql<number>`count(*)::int` })
    .from(leadFiles)
    .innerJoin(files, eq(files.id, leadFiles.fileId))
    .where(and(eq(leadFiles.tenantId, tenantId), inArray(leadFiles.leadId, leadIds), isNull(files.deletedAt)))
    .groupBy(leadFiles.leadId);
  return new Map(rows.map((r) => [r.leadId, Number(r.n)]));
}

export async function historyOfFile(db: Db, tenantId: string, fileId: string) {
  return db.select().from(filesHistory).where(and(eq(filesHistory.tenantId, tenantId), eq(filesHistory.fileId, fileId))).orderBy(desc(filesHistory.id));
}

/** "Attachments: a.pdf, b.png" for the end of a copied draft, or "" when there are none. */
export const attachmentsLine = (names: string[]) => (names.length ? `Attachments: ${names.join(", ")}` : "");
