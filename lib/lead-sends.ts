// The send log: one row per lead and channel, so the sample link test can count sends, replies and closes per
// variant. It follows the board: a Mark sent adds a row, the × takes it away, the Result fills the reply and the close. No
// person is ever stored or read here. A failure here never fails the Mark sent that caused it: the board's write is already
// committed, and the error is logged by its code only (a query's text could carry a lead's data).
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./db";
import { leadSampleTests, leads, leadSends } from "./db/schema";
import { CHANNELS, firstMessageLink, nextVariant, parseAmount, sendVariant, settleOutcome, summarise, type Assigned, type Channel, type OutcomePatch, type Variant } from "./send-test";

const EMAIL_SENT = "Email Sent";
const WHATSAPP_SENT = "WhatsApp msg sent";

function logged(step: string, err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  console.error("lead-sends", JSON.stringify({ step, code: e?.code ?? e?.cause?.code ?? "error" }));
}

export async function variantsOf(db: Db, tenantId: string, ids: string[]): Promise<Map<string, Assigned>> {
  if (!ids.length) return new Map();
  const rows = await db.select({ leadId: leadSampleTests.leadId, variant: leadSampleTests.variant }).from(leadSampleTests).where(and(eq(leadSampleTests.tenantId, tenantId), inArray(leadSampleTests.leadId, ids)));
  return new Map(rows.map((r) => [r.leadId, r.variant as Assigned]));
}

/** The lead's group, set once and alternating across the company's leads; the lock keeps two at once from taking the same turn. */
async function assign(db: Db, tenantId: string, leadId: string): Promise<Assigned> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lead-sample-test:${tenantId}`}))`);
    const [have] = await tx.select({ variant: leadSampleTests.variant }).from(leadSampleTests).where(eq(leadSampleTests.leadId, leadId));
    if (have) return have.variant as Assigned;
    const counts = await tx.select({ variant: leadSampleTests.variant, n: sql<number>`count(*)::int` }).from(leadSampleTests).where(eq(leadSampleTests.tenantId, tenantId)).groupBy(leadSampleTests.variant);
    const of = (v: Assigned) => counts.find((c) => c.variant === v)?.n ?? 0;
    const variant = nextVariant(of("link_first"), of("after_reply"));
    await tx.insert(leadSampleTests).values({ tenantId, leadId, variant });
    return variant;
  });
}

const sameTime = (a: Date | null, b: Date | null) => (a?.getTime() ?? null) === (b?.getTime() ?? null);
const changed = (r: OutcomePatch, p: OutcomePatch) => !sameTime(r.repliedAt, p.repliedAt) || !sameTime(r.closedAt, p.closedAt) || r.result !== p.result || r.amountCents !== p.amountCents;

async function settle(db: Db, tenantId: string, leadId: string, result: string | null, chosen: Channel | null, now: Date) {
  const rows = await db.select().from(leadSends).where(and(eq(leadSends.tenantId, tenantId), eq(leadSends.leadId, leadId)));
  const plan = settleOutcome(rows, result, chosen, now);
  for (const r of rows) {
    const p = plan.get(r.id);
    if (p && changed(r, p)) await db.update(leadSends).set(p).where(eq(leadSends.id, r.id));
  }
}

export type SyncInfo = {
  /** The channels this write marked sent: only these may add a row, so a later edit never dates an old send "now". */
  sent?: Partial<Record<Channel, boolean>>;
  sentAt?: Date | null;
  /** Marked after the fact (Leads → Mark already sent): logged only with the date the person gave. */
  past?: boolean;
  now?: Date;
};

async function sync(db: Db, tenantId: string, leadId: string, info: SyncInfo) {
  const now = info.now ?? new Date();
  const [l] = await db
    .select({ emailStatus: leads.emailStatus, whatsappStatus: leads.whatsappStatus, result: leads.result, sampleUrl: leads.sampleUrl, draftEmail: leads.draftEmail, draftWhatsapp: leads.draftWhatsapp })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
  if (!l) return;
  let assigned = (await variantsOf(db, tenantId, [leadId])).get(leadId) ?? null;
  // only a lead not yet emailed joins the test: its first message can still follow the group
  if (!assigned && (l.sampleUrl ?? "").trim() && l.emailStatus !== EMAIL_SENT && !l.result) assigned = await assign(db, tenantId, leadId);
  const rows = await db.select({ id: leadSends.id, channel: leadSends.channel }).from(leadSends).where(and(eq(leadSends.tenantId, tenantId), eq(leadSends.leadId, leadId)));
  const on: Record<Channel, boolean> = { email: l.emailStatus === EMAIL_SENT, whatsapp: l.whatsappStatus === WHATSAPP_SENT };
  for (const channel of CHANNELS) {
    const row = rows.find((r) => r.channel === channel);
    if (row && !on[channel]) await db.delete(leadSends).where(eq(leadSends.id, row.id));
    if (row || !on[channel] || !info.sent?.[channel]) continue;
    const given = info.sentAt && info.sentAt.getTime() <= now.getTime() ? info.sentAt : null;
    const sentAt = given ?? (info.past ? null : now);
    if (!sentAt) continue; // never a guessed date
    const variant: Variant = sendVariant({ channel, url: l.sampleUrl, assigned, draft: channel === "email" ? l.draftEmail : l.draftWhatsapp, past: info.past });
    await db.insert(leadSends).values({ tenantId, leadId, channel, variant, sentAt, source: info.past ? "already_sent" : "mark" }).onConflictDoNothing();
  }
  await settle(db, tenantId, leadId, l.result, null, now);
}

/** Bring the lead's send rows in line with the board. Never throws. */
export async function syncLeadSends(db: Db, tenantId: string, leadId: string, info: SyncInfo = {}): Promise<void> {
  try {
    await sync(db, tenantId, leadId, info);
  } catch (err) {
    logged("sync", err);
  }
}

export type SendLog = { variant: Assigned | null; sends: { channel: Channel; variant: Variant; replied: boolean; closed: boolean; amountCents: number | null; linkSent: boolean }[] };

/** For the lead's drawer: its group and sends. Null when it could not be read, so the drawer still opens. */
export async function sendLogOf(db: Db, tenantId: string, leadId: string): Promise<SendLog | null> {
  try {
    const [variants, rows] = await Promise.all([variantsOf(db, tenantId, [leadId]), db.select().from(leadSends).where(and(eq(leadSends.tenantId, tenantId), eq(leadSends.leadId, leadId)))]);
    return {
      variant: variants.get(leadId) ?? null,
      sends: rows.map((r) => ({ channel: r.channel as Channel, variant: r.variant as Variant, replied: !!r.repliedAt, closed: !!r.closedAt, amountCents: r.amountCents, linkSent: !!r.linkSentAt })),
    };
  } catch (err) {
    logged("read", err);
    return null;
  }
}

/** The one extra click after a result: which channel they answered, the amount won, or the sample link copied after a reply. */
export async function answerSend(db: Db, tenantId: string, leadId: string, a: { channel?: unknown; amount?: unknown; link?: unknown }, now = new Date()): Promise<{ ok: true } | { ok: false; error: string }> {
  const channel = a.channel === undefined || a.channel === null ? null : (CHANNELS as readonly unknown[]).includes(a.channel) ? (a.channel as Channel) : "bad";
  if (channel === "bad") return { ok: false, error: "That channel is not one of ours." };
  const amount = parseAmount(a.amount);
  if (amount === "bad") return { ok: false, error: "Type the amount as a number, like 1200." };
  const [l] = await db.select({ result: leads.result }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, leadId)));
  if (!l) return { ok: false, error: "No such lead." };
  const base = () => and(eq(leadSends.tenantId, tenantId), eq(leadSends.leadId, leadId));
  if (channel) {
    const [has] = await db.select({ id: leadSends.id }).from(leadSends).where(and(base(), eq(leadSends.channel, channel)));
    if (!has) return { ok: false, error: "No send on that channel is logged for this lead." };
    await settle(db, tenantId, leadId, l.result, channel, now);
  }
  if (amount !== null) {
    if (l.result !== "Client") return { ok: false, error: "An amount goes on a lead marked Won." };
    const [won] = await db.update(leadSends).set({ amountCents: amount }).where(and(base(), sql`${leadSends.closedAt} is not null`)).returning();
    if (!won) return { ok: false, error: "Say which channel they answered first." };
  }
  if (a.link === true) await db.update(leadSends).set({ linkSentAt: now }).where(and(base(), sql`${leadSends.repliedAt} is not null`, sql`${leadSends.linkSentAt} is null`));
  return { ok: true };
}

/** The rows with only the link this first message may carry, and whether one is being held back for after a reply. */
export async function withFirstLink<T extends { id: string; sample: string | null }>(db: Db, tenantId: string, channel: Channel, rows: T[]): Promise<(T & { sampleHeld: boolean })[]> {
  const ids = rows.filter((r) => r.sample).map((r) => r.id);
  const variants = channel === "email" ? await variantsOf(db, tenantId, ids) : new Map<string, Assigned>();
  return rows.map((r) => {
    const sample = firstMessageLink(channel, r.sample, variants.get(r.id) ?? null, null);
    return { ...r, sample, sampleHeld: !!r.sample && !sample };
  });
}

/** The result page's numbers. Reads the send log and the group count only: lead data, no person. */
export async function sampleTestResults(db: Db, tenantId: string) {
  const [rows, grouped] = await Promise.all([
    db.select({ leadId: leadSends.leadId, channel: leadSends.channel, variant: leadSends.variant, repliedAt: leadSends.repliedAt, closedAt: leadSends.closedAt, result: leadSends.result, amountCents: leadSends.amountCents }).from(leadSends).where(eq(leadSends.tenantId, tenantId)),
    db.select({ n: sql<number>`count(*)::int` }).from(leadSampleTests).where(eq(leadSampleTests.tenantId, tenantId)),
  ]);
  return { ...summarise(rows), leadsInTest: grouped[0]?.n ?? 0 };
}
