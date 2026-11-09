// The Leads page's Send next tab: the leads to email next, best first. Its source, in order:
// 1. the list the Validator pushed (PUT /v1/lists/send-next with its key; kept in lead_lists as sent);
// 2. on this Mac, the Validator's file itself (SEND_NEXT_FILE, e.g. the fleet's common-data/shared-state/send-next.json);
// 3. else the board's own rule: a draft that is not "skip:", not sent, no result yet, best score first.
// The list names leads by Notion page id (the board's old handle) or by Peek id; a name the board does not hold is
// counted, not shown. "Held" leads (the Validator's reasons) are listed under it.
import { readFile } from "node:fs/promises";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { Db } from "./db";
import { claims, leadLists, leads, users } from "./db/schema";
import { attachmentNames } from "./lead-queue";

export type SendNextRow = {
  id: string;
  business: string;
  contact: string | null;
  role: string | null;
  email: string | null;
  whatsapp: string | null;
  score: number | null;
  pkg: string | null;
  draft: string | null;
  /** The sample site the team made: Copy draft ends with it. */
  sample: string | null;
  emailStatus: string | null;
  note: string;
  takenBy: { userId: string; name: string } | null;
  /** The files attached for this lead's email: the paperclip count, and "Attachments: …" on a copied draft. */
  attachments: string[];
};
export type SendNext = { source: "validator" | "file" | "board"; generatedAt: string | null; rows: SendNextRow[]; held: { business: string; reason: string }[]; missing: number };

type Item = { id?: unknown; notion_page_id?: unknown; note?: unknown; reason?: unknown; name?: unknown };
const idOf = (x: Item) => String(x.id ?? x.notion_page_id ?? "").replace(/-/g, "").toLowerCase();
const isUuid = (s: string) => /^[0-9a-f]{32}$/.test(s);
const UUID_DASHED = (s: string) => `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
const LIMIT = 30;

/** Keep what a machine pushed, as it came (size checked by the route). */
export async function saveList(db: Db, tenantId: string, name: string, data: Record<string, unknown>, by: string) {
  await db
    .insert(leadLists)
    .values({ tenantId, name, data, updatedBy: by })
    .onConflictDoUpdate({ target: [leadLists.tenantId, leadLists.name], set: { data, updatedAt: new Date(), updatedBy: by } });
}

async function pushed(db: Db, tenantId: string): Promise<{ source: SendNext["source"]; data: Record<string, unknown> } | null> {
  const [l] = await db.select().from(leadLists).where(and(eq(leadLists.tenantId, tenantId), eq(leadLists.name, "send-next")));
  if (l) return { source: "validator", data: l.data };
  const file = process.env.SEND_NEXT_FILE?.trim();
  if (!file) return null;
  try {
    return { source: "file", data: JSON.parse(await readFile(file.replace(/^~/, process.env.HOME ?? "~"), "utf8")) };
  } catch {
    return null;
  }
}

const columns = {
  id: leads.id,
  notionPageId: leads.notionPageId,
  business: leads.business,
  contact: leads.contactPerson,
  role: leads.contactRole,
  email: leads.businessEmail,
  whatsapp: leads.whatsapp,
  score: leads.leadScore,
  pkg: leads.package,
  draft: leads.draftEmail,
  sample: leads.sampleUrl,
  emailStatus: leads.emailStatus,
  takenId: claims.userId,
  takenName: sql<string | null>`coalesce(nullif(trim(${users.name}), ''), split_part(${users.email}, '@', 1))`,
};

export async function sendNext(db: Db, tenantId: string): Promise<SendNext> {
  const s = await sendNextRows(db, tenantId);
  if (!s.rows.length) return s;
  const names = await attachmentNames(db, tenantId, s.rows.map((r) => r.id));
  for (const r of s.rows) r.attachments = names.get(r.id) ?? [];
  return s;
}

async function sendNextRows(db: Db, tenantId: string): Promise<SendNext> {
  const list = await pushed(db, tenantId);
  const base = () =>
    db
      .select(columns)
      .from(leads)
      .leftJoin(claims, and(eq(claims.tenantId, leads.tenantId), eq(claims.pageId, sql`${leads.id}::text`)))
      .leftJoin(users, eq(users.id, claims.userId));
  const shape = (r: Awaited<ReturnType<typeof base>>[number], note = ""): SendNextRow => ({
    id: r.id,
    business: r.business,
    contact: r.contact,
    role: r.role,
    email: r.email,
    whatsapp: r.whatsapp,
    score: r.score,
    pkg: r.pkg,
    draft: r.draft,
    sample: r.sample,
    emailStatus: r.emailStatus,
    note,
    takenBy: r.takenId ? { userId: r.takenId, name: r.takenName ?? "" } : null,
    attachments: [],
  });

  if (list) {
    const next = (Array.isArray(list.data.next) ? list.data.next : []) as Item[];
    const held = (Array.isArray(list.data.held) ? list.data.held : []) as Item[];
    const ids = next.map(idOf).filter(isUuid);
    const rows = ids.length
      ? await base().where(and(eq(leads.tenantId, tenantId), or(inArray(leads.notionPageId, ids), inArray(leads.id, ids.map(UUID_DASHED)))))
      : [];
    const byKey = new Map<string, (typeof rows)[number]>();
    for (const r of rows) {
      byKey.set(r.id.replace(/-/g, ""), r);
      if (r.notionPageId) byKey.set(r.notionPageId, r);
    }
    // In the Validator's order; a lead marked sent since the list was made drops off.
    const shown = next
      .map((x) => ({ r: byKey.get(idOf(x)), note: String(x.note ?? "") }))
      .filter((x) => x.r && x.r.emailStatus !== "Email Sent")
      .map((x) => shape(x.r!, x.note));
    return {
      source: list.source,
      generatedAt: typeof list.data.generated_at === "string" ? list.data.generated_at : null,
      rows: shown,
      held: held.map((h) => ({ business: String(h.name ?? h.id ?? ""), reason: String(h.reason ?? "") })).filter((h) => h.business),
      missing: next.filter((x) => !byKey.has(idOf(x))).length,
    };
  }

  const rows = await base()
    .where(
      and(
        eq(leads.tenantId, tenantId),
        eq(leads.archived, false),
        sql`${leads.draftEmail} is not null and ${leads.draftEmail} not ilike 'skip:%'`,
        or(isNull(leads.emailStatus), eq(leads.emailStatus, "Ready to Send Email")),
        isNull(leads.result),
      ),
    )
    .orderBy(sql`${leads.leadScore} desc nulls last`, leads.createdAt)
    .limit(LIMIT);
  return { source: "board", generatedAt: null, rows: rows.map((r) => shape(r)), held: [], missing: 0 };
}
