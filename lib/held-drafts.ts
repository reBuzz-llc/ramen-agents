// A message never states what we have not done: a draft saying a website
// was created, with no approved sample, is off every send list until the Validator closes its OW27 note. The note stays
// off the screens; the one line here is the reason the row cannot be sent. Nothing here changes a draft.
import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "./db";
import { leadFlags } from "./db/schema";

export const HOLD_RULE = "OW27";
export const HELD_LINE = "Held: this draft says a website was created and no sample is approved. Edit the sentence or ask the owner.";
export type HeldLead = { id: string; business: string };

const held = sql`exists (select 1 from ${leadFlags} f where f.tenant_id = "leads"."tenant_id" and f.lead_id = "leads"."id" and f.rule = ${HOLD_RULE} and f.status = 'open')`;
/** For a query that reads "leads": the row is on hold. */
export const isHeld = held;
/** For a query that reads "leads": the row may be sent. */
export const notHeld = sql`not ${held}`;

/** Which of these leads are on hold. */
export async function heldIds(db: Db, tenantId: string, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await db
    .select({ leadId: leadFlags.leadId })
    .from(leadFlags)
    .where(and(eq(leadFlags.tenantId, tenantId), inArray(leadFlags.leadId, ids), eq(leadFlags.rule, HOLD_RULE), eq(leadFlags.status, "open")));
  return new Set(rows.map((r) => r.leadId));
}
