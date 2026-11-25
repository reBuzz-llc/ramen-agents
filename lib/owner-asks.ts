// Two clicks with real consequences move to Peek, where the click is a signed-in person's.
// (a) A LinkedIn post goes out only after the owner's Approve, bound to the exact words and the place they go, and used once.
// (b) A billing bench is lifted only by the owner's "Still free". A machine key can file a proposal, add a bench and use up an
// approval. It can never create, change or restore an approval, and never clear a bench.
// Honest limit: anyone holding the database login on this Mac can still write these rows, or a session row, directly.
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { sha256 } from "./crypto";
import type { Db } from "./db";
import { billingBenches, ownerAnswers, ownerAsks, users } from "./db/schema";

export const ASK_KINDS = ["linkedin_post"] as const;
export const ASK_TARGETS = ["profile-post", "profile-headline", "profile-about"] as const;
export type AskKind = (typeof ASK_KINDS)[number];
export type AskTarget = (typeof ASK_TARGETS)[number];
const TEXT_MAX = 10_000;
const TITLE_MAX = 200;
const SUBJECT_MAX = 120;

export class AskError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type AskView = { found: true; kind: string; subject: string; target: string; textHash: string; byOwner: boolean; person: string | null; at: string | null; withdrawn: boolean; withdrawnAt: string | null; usedAt: string | null };
export type Who = { userId: string; name: string; role: string };

/** The words' fingerprint: sha256 of the UTF-8 text exactly as sent, lowercase hex, nothing trimmed. */
export const textHashOf = (text: string) => sha256(text);

const askKey = (v: Record<string, unknown>) => {
  const kind = ASK_KINDS.find((k) => k === v.kind);
  if (!kind) throw new AskError(400, `kind is ${ASK_KINDS.join(" or ")}`);
  if (typeof v.subject !== "string" || !v.subject.trim() || v.subject.length > SUBJECT_MAX) throw new AskError(400, `subject is 1 to ${SUBJECT_MAX} characters`);
  return { kind, subject: v.subject };
};

/** The answer that counts for this generation of the words: the latest one, withdrawn or not. */
async function latest(d: Db, askId: string, generation: number) {
  const [a] = await d
    .select({ id: ownerAnswers.id, textHash: ownerAnswers.textHash, target: ownerAnswers.target, byName: ownerAnswers.byName, byRole: ownerAnswers.byRole, at: ownerAnswers.at, withdrawnAt: ownerAnswers.withdrawnAt, usedAt: ownerAnswers.usedAt, active: users.active, role: users.role })
    .from(ownerAnswers)
    .leftJoin(users, eq(users.id, ownerAnswers.byUser))
    .where(and(eq(ownerAnswers.askId, askId), eq(ownerAnswers.generation, generation)))
    .orderBy(desc(ownerAnswers.at), desc(ownerAnswers.id))
    .limit(1);
  return a ?? null;
}
type Ask = typeof ownerAsks.$inferSelect;
type Latest = Awaited<ReturnType<typeof latest>> | null;

/** True only for a live approval of exactly these words and this place, by someone who is an active owner now and was then. */
const ownerLive = (ask: Ask, a: Latest) => !!a && !a.withdrawnAt && a.byRole === "owner" && a.active === true && a.role === "owner" && a.textHash === ask.textHash && a.target === ask.target;
const viewOf = (ask: Ask, a: Latest): AskView => ({
  found: true,
  kind: ask.kind,
  subject: ask.subject,
  target: ask.target,
  textHash: ask.textHash,
  byOwner: ownerLive(ask, a),
  person: a?.byName ?? null,
  at: a?.at.toISOString() ?? null,
  withdrawn: !!a?.withdrawnAt,
  withdrawnAt: a?.withdrawnAt?.toISOString() ?? null,
  usedAt: a?.usedAt?.toISOString() ?? null,
});

/** A key files a proposal. The same words and place change nothing; anything else starts a new generation with no approval. */
export async function fileAsk(d: Db, tenantId: string, v: Record<string, unknown>, by: string): Promise<AskView> {
  const { kind, subject } = askKey(v);
  const target = ASK_TARGETS.find((t) => t === v.target);
  if (!target) throw new AskError(400, `target is ${ASK_TARGETS.join(", ")}`);
  if (typeof v.text !== "string" || !v.text.length || v.text.length > TEXT_MAX) throw new AskError(400, `text is 1 to ${TEXT_MAX} characters`);
  if (typeof v.title !== "string" || !v.title.trim() || v.title.length > TITLE_MAX) throw new AskError(400, `title is 1 to ${TITLE_MAX} characters`);
  if (v.channel !== "linkedin") throw new AskError(400, "channel is linkedin");
  const text = v.text;
  const title = v.title;
  const textHash = textHashOf(text);
  return d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.insert(ownerAsks).values({ tenantId, kind, subject, target, title, text, channel: "linkedin", textHash, filedBy: by.slice(0, 80) }).onConflictDoNothing();
    const [ask] = await t.select().from(ownerAsks).where(and(eq(ownerAsks.tenantId, tenantId), eq(ownerAsks.kind, kind), eq(ownerAsks.subject, subject))).for("update");
    if (ask.textHash === textHash && ask.target === target) return viewOf(ask, await latest(t, ask.id, ask.generation));
    const [next] = await t.update(ownerAsks).set({ target, title, text, textHash, generation: ask.generation + 1, filedBy: by.slice(0, 80), changedAt: new Date() }).where(eq(ownerAsks.id, ask.id)).returning();
    return viewOf(next, null);
  });
}

export async function readAsk(d: Db, tenantId: string, kindRaw: unknown, subjectRaw: unknown): Promise<AskView | { found: false }> {
  const { kind, subject } = askKey({ kind: kindRaw, subject: subjectRaw });
  const [ask] = await d.select().from(ownerAsks).where(and(eq(ownerAsks.tenantId, tenantId), eq(ownerAsks.kind, kind), eq(ownerAsks.subject, subject)));
  return ask ? viewOf(ask, await latest(d, ask.id, ask.generation)) : { found: false };
}

/** A key records that an approval was used. Only a live owner approval of the current words can be used, and the first time stays. */
export async function spendAsk(d: Db, tenantId: string, v: Record<string, unknown>, now = new Date()): Promise<{ usedAt: string }> {
  const { kind, subject } = askKey(v);
  if (typeof v.textHash !== "string") throw new AskError(400, "send textHash");
  const textHash = v.textHash;
  return d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [ask] = await t.select().from(ownerAsks).where(and(eq(ownerAsks.tenantId, tenantId), eq(ownerAsks.kind, kind), eq(ownerAsks.subject, subject))).for("update");
    if (!ask) throw new AskError(404, "no such ask");
    if (ask.textHash !== textHash) throw new AskError(409, "those are not the words on file now");
    const a = await latest(t, ask.id, ask.generation);
    if (!a || !ownerLive(ask, a)) throw new AskError(409, "no live owner approval of these words");
    if (a.usedAt) return { usedAt: a.usedAt.toISOString() };
    await t.update(ownerAnswers).set({ usedAt: now }).where(eq(ownerAnswers.id, a.id));
    return { usedAt: now.toISOString() };
  });
}

const mustOwn = (who: Who) => {
  if (who.role !== "owner") throw new AskError(403, "only the owner can answer this");
};

/** The owner's Approve, on the words they were shown. */
export async function approveAsk(d: Db, tenantId: string, askId: string, seenHash: unknown, who: Who, now = new Date()): Promise<void> {
  mustOwn(who);
  await d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [ask] = await t.select().from(ownerAsks).where(and(eq(ownerAsks.tenantId, tenantId), eq(ownerAsks.id, askId))).for("update");
    if (!ask) throw new AskError(404, "no such ask");
    if (ask.textHash !== seenHash) throw new AskError(409, "The words changed since you opened this page. Read them again before approving.");
    const a = await latest(t, ask.id, ask.generation);
    if (a?.usedAt) throw new AskError(409, "This one has already been posted.");
    if (a && !a.withdrawnAt) return;
    await t.insert(ownerAnswers).values({ tenantId, askId: ask.id, generation: ask.generation, textHash: ask.textHash, target: ask.target, byUser: who.userId, byName: who.name.slice(0, 80), byRole: who.role, at: now });
  });
}

/** The owner takes a yes back, until it has been used. */
export async function withdrawAsk(d: Db, tenantId: string, askId: string, who: Who, now = new Date()): Promise<void> {
  mustOwn(who);
  await d.transaction(async (tx) => {
    const t = tx as unknown as Db;
    const [ask] = await t.select().from(ownerAsks).where(and(eq(ownerAsks.tenantId, tenantId), eq(ownerAsks.id, askId))).for("update");
    if (!ask) throw new AskError(404, "no such ask");
    const a = await latest(t, ask.id, ask.generation);
    if (!a || a.withdrawnAt) throw new AskError(409, "There is no approval to withdraw.");
    if (a.usedAt) throw new AskError(409, "This one has already been posted, so it cannot be withdrawn here.");
    await t.update(ownerAnswers).set({ withdrawnAt: now, withdrawnBy: who.userId }).where(and(eq(ownerAnswers.id, a.id), isNull(ownerAnswers.withdrawnAt)));
  });
}

/** The owner's page: every ask, newest change first, with the words verbatim. */
export async function asksForOwner(d: Db, tenantId: string) {
  const rows = await d.select().from(ownerAsks).where(eq(ownerAsks.tenantId, tenantId)).orderBy(desc(ownerAsks.changedAt)).limit(100);
  return Promise.all(rows.map(async (r) => ({ id: r.id, title: r.title, text: r.text, channel: r.channel, filedAt: r.changedAt.toISOString(), ...viewOf(r, await latest(d, r.id, r.generation)) })));
}

// ---- billing benches ----------------------------------------------------------------------------------------------------
export type BenchView = { id: string; host: string; itemId: string; why: string; at: string; cleared: boolean; clearedAt: string | null; byOwner: boolean; person: string | null };

/** A key adds a bench. The same host and item twice keeps the first; a key can never clear or change one. */
export async function addBench(d: Db, tenantId: string, v: Record<string, unknown>, by: string, now = new Date()): Promise<BenchView> {
  const host = typeof v.host === "string" ? v.host.trim().toLowerCase() : "";
  const itemId = typeof v.itemId === "string" ? v.itemId.trim() : "";
  const why = typeof v.why === "string" ? v.why.trim() : "";
  if (!host || host.length > 120) throw new AskError(400, "host is 1 to 120 characters");
  if (!itemId || itemId.length > 120) throw new AskError(400, "itemId is 1 to 120 characters");
  if (!why || why.length > 500) throw new AskError(400, "why is 1 to 500 characters");
  const at = v.at === undefined ? now : new Date(String(v.at));
  if (Number.isNaN(at.getTime()) || at.getTime() > now.getTime() + 60_000) throw new AskError(400, "at is a time that is not in the future");
  await d.insert(billingBenches).values({ tenantId, host, itemId, why, at, filedBy: by.slice(0, 80) }).onConflictDoNothing();
  return (await listBenches(d, tenantId)).find((b) => b.host === host && b.itemId === itemId)!;
}

export async function listBenches(d: Db, tenantId: string): Promise<BenchView[]> {
  const rows = await d
    .select({ id: billingBenches.id, host: billingBenches.host, itemId: billingBenches.itemId, why: billingBenches.why, at: billingBenches.at, clearedAt: billingBenches.clearedAt, clearedName: billingBenches.clearedName, clearedRole: billingBenches.clearedRole, active: users.active, role: users.role })
    .from(billingBenches)
    .leftJoin(users, eq(users.id, billingBenches.clearedBy))
    .where(eq(billingBenches.tenantId, tenantId))
    .orderBy(desc(billingBenches.at), sql`${billingBenches.id}`);
  return rows.map((r) => ({
    id: r.id,
    host: r.host,
    itemId: r.itemId,
    why: r.why,
    at: r.at.toISOString(),
    cleared: !!r.clearedAt,
    clearedAt: r.clearedAt?.toISOString() ?? null,
    byOwner: !!r.clearedAt && r.clearedRole === "owner" && r.active === true && r.role === "owner",
    person: r.clearedName,
  }));
}

/** The owner's "Still free: use it again". */
export async function clearBench(d: Db, tenantId: string, id: string, who: Who, now = new Date()): Promise<void> {
  mustOwn(who);
  const [row] = await d.update(billingBenches).set({ clearedAt: now, clearedBy: who.userId, clearedName: who.name.slice(0, 80), clearedRole: who.role }).where(and(eq(billingBenches.tenantId, tenantId), eq(billingBenches.id, id), isNull(billingBenches.clearedAt))).returning();
  if (!row) throw new AskError(409, "That bench is gone or already cleared.");
}
