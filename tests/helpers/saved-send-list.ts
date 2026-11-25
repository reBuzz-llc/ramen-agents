// Send next reads only a saved list, so a test that needs one saves what the Validator would pick from its board.
import { and, desc, asc, eq, isNull, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { saveList } from "@/lib/send-next";

export async function saveBoardAsList(db: Db, tenantId: string) {
  const rows = await db
    .select({ id: leads.id })
    .from(leads)
    .where(and(eq(leads.tenantId, tenantId), eq(leads.archived, false), sql`${leads.draftEmail} is not null and ${leads.draftEmail} not ilike 'skip:%'`, or(isNull(leads.emailStatus), eq(leads.emailStatus, "Ready to Send Email")), isNull(leads.result)))
    .orderBy(sql`${leads.leadScore} desc nulls last`, asc(leads.createdAt), desc(leads.id))
    .limit(30);
  await saveList(db, tenantId, "send-next", { generated_at: "2026-11-22T00:00:00", next: rows.map((r) => ({ id: r.id })), held: [] }, "test");
}
