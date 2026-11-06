// Our queue's lead tabs, on Peek's own lead store.
// One flow with two entrances: the same rows, claims and writes as Leads → Send next.
//   - "review": a draft (not a "skip:" note), no email status yet, no result;
//   - "send": email status "Ready to Send Email", no result;
//   - best lead score first, then by business name.
// The writes go through lib/leads.ts as the signed-in person: "Reviewed, ready to send" is the drawer's Ready to send
// step, "I sent it" its Mark email sent step (email status Email Sent, result Emailed and its date; the store fills
// Sent by and Sent at). Nothing is sent from here.
import { and, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { Db } from "./db";
import { files, leadFiles, leads, tasks } from "./db/schema";
import { emailSteps } from "./lead-workflow";
import { writeLead, type Actor, type Refusal } from "./leads";
import type { QueueRow } from "./queue";
import type { LeadFact, TaskFact } from "./scoreboard";

export const STATUS_REVIEWED = "Ready to Send Email";
export const STATUS_SENT = "Email Sent";
export const WRITABLE = [STATUS_REVIEWED, STATUS_SENT] as const;
/** The list carries this many characters of each draft; the card reads the full text when opened. */
const CUT = 300;

export async function leadQueue(db: Db, tenantId: string): Promise<QueueRow[]> {
  const rows = await db
    .select({
      id: leads.id,
      business: leads.business,
      contact: leads.contactPerson,
      role: leads.contactRole,
      email: leads.businessEmail,
      website: leads.website,
      whatsapp: leads.whatsapp,
      draft: sql<string>`left(${leads.draftEmail}, ${sql.raw(String(CUT))})`,
      draftLen: sql<number>`length(${leads.draftEmail})`,
      whatsappDraft: sql<
        string | null
      >`left(${leads.draftWhatsapp}, ${sql.raw(String(CUT))})`,
      whatsappLen: sql<number | null>`length(${leads.draftWhatsapp})`,
      score: leads.leadScore,
      status: leads.emailStatus,
      industry: leads.industry,
      location: leads.location,
      pkg: leads.package,
      created: leads.createdAt,
    })
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.archived, false),
        sql`${leads.draftEmail} is not null and btrim(${leads.draftEmail}) <> '' and ${leads.draftEmail} !~* '^\\s*skip\\s*:'`,
        or(isNull(leads.emailStatus), eq(leads.emailStatus, STATUS_REVIEWED)),
        isNull(leads.result),
      ),
    )
    .orderBy(sql`${leads.leadScore} desc nulls last`, leads.business);
  const names = await attachmentNames(
    db,
    tenantId,
    rows.map((r) => r.id),
  );
  return rows.map((r) => ({
    kind: r.status === STATUS_REVIEWED ? "send" : "review",
    pageId: r.id,
    url: `/leads/${r.id}`,
    business: r.business,
    contact: r.contact ?? "",
    role: r.role ?? "",
    email: r.email ?? "",
    website: r.website ?? "",
    whatsapp: r.whatsapp ?? "",
    draft: r.draft.trim(),
    whatsappDraft: (r.whatsappDraft ?? "").trim(),
    draftCut: Number(r.draftLen) > CUT || Number(r.whatsappLen ?? 0) > CUT,
    score: r.score,
    status: r.status ?? "",
    industry: r.industry ?? "",
    location: r.location ?? "",
    pkg: r.pkg ?? "",
    created: r.created.toISOString(),
    attachments: names.get(r.id) ?? [],
  }));
}

/** The files attached for each lead's email, oldest first: what "Attachments: …" names on a copied draft. */
export async function attachmentNames(
  db: Db,
  tenantId: string,
  ids: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!ids.length) return out;
  const rows = await db
    .select({ leadId: leadFiles.leadId, name: files.name })
    .from(leadFiles)
    .innerJoin(files, eq(files.id, leadFiles.fileId))
    .where(
      and(
        eq(leadFiles.tenantId, tenantId),
        inArray(leadFiles.leadId, ids),
        isNull(files.deletedAt),
      ),
    )
    .orderBy(leadFiles.at);
  for (const r of rows)
    out.set(r.leadId, [...(out.get(r.leadId) ?? []), r.name]);
  return out;
}

/** What This week, the Leaderboard and a statement count, from Peek's own board: the leads sent or
 *  with a result, and the tasks Done, changed or dated on or after `from`. */
export async function scoreFacts(
  db: Db,
  tenantId: string,
  from: Date,
): Promise<{ leads: LeadFact[]; tasks: TaskFact[] }> {
  const day = from.toISOString().slice(0, 10);
  const [leadRows, taskRows] = await Promise.all([
    db
      .select({
        id: leads.id,
        notionPageId: leads.notionPageId,
        emailStatus: leads.emailStatus,
        sentBy: leads.sentBy,
        sentAt: leads.sentAt,
        result: leads.result,
        resultDate: leads.resultDate,
        updatedAt: leads.updatedAt,
      })
      .from(leads)
      .where(
        and(
          eq(leads.tenantId, tenantId),
          eq(leads.archived, false),
          or(eq(leads.emailStatus, STATUS_SENT), isNotNull(leads.result)),
          or(
            gte(leads.sentAt, from),
            gte(leads.resultDate, day),
            gte(leads.updatedAt, from),
          ),
        ),
      ),
    db
      .select({
        status: tasks.status,
        assignees: tasks.assignees,
        updatedAt: tasks.updatedAt,
      })
      .from(tasks)
      .where(
        and(
          eq(tasks.tenantId, tenantId),
          eq(tasks.archived, false),
          eq(tasks.status, "Done"),
          gte(tasks.updatedAt, from),
        ),
      ),
  ]);
  return {
    leads: leadRows.map((r) => ({ ...r, sentBy: r.sentBy ?? [] })),
    tasks: taskRows.map((t) => ({ ...t, assignees: t.assignees ?? [] })),
  };
}

/** One lead's full drafts, for the card. */
export async function draftsOfLead(
  db: Db,
  tenantId: string,
  id: string,
): Promise<{ draft: string; whatsappDraft: string } | null> {
  const [r] = await db
    .select({ draft: leads.draftEmail, whatsappDraft: leads.draftWhatsapp })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.id, id)));
  return r
    ? {
        draft: (r.draft ?? "").trim(),
        whatsappDraft: (r.whatsappDraft ?? "").trim(),
      }
    : null;
}

/** The fields a queue mark writes: the drawer's own steps. */
export function markFields(
  status: (typeof WRITABLE)[number],
  now = new Date(),
): Record<string, unknown> {
  return status === STATUS_SENT
    ? emailSteps({ email_status: STATUS_REVIEWED }, now)[0].fields
    : emailSteps({}, now)[0].fields;
}

/** Mark a lead reviewed or sent as `actor`. Answers the status as stored, or why it was not written. */
export async function markLead(
  db: Db,
  tenantId: string,
  id: string,
  status: (typeof WRITABLE)[number],
  actor: Actor,
  now = new Date(),
): Promise<{ ok: true; status: string } | { ok: false; error: string }> {
  const r = await writeLead(
    db,
    tenantId,
    { id },
    markFields(status, now),
    actor,
  );
  if (!r.ok) return { ok: false, error: r.message };
  const refused = r.refused.find((x: Refusal) => x.field === "email_status");
  if (refused)
    return { ok: false, error: `Not saved: email status (${refused.reason})` };
  return { ok: true, status: String(r.lead.email_status ?? "") };
}

/** This week's sent emails: leads at Email Sent whose sent date (or, for rows without one, result date) is on or after
 *  `from` (YYYY-MM-DD, the week's first day). */
export async function sentSinceOnPeek(
  db: Db,
  tenantId: string,
  from: string,
): Promise<number> {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(leads)
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.emailStatus, STATUS_SENT),
        or(
          gte(sql`(${leads.sentAt})::date`, from),
          and(isNull(leads.sentAt), gte(leads.resultDate, from)),
        ),
      ),
    );
  return Number(r?.n ?? 0);
}
