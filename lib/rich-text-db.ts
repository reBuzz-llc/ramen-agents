// The formatted copy of a lead's long cells. The cell stays the truth: a copy is stored with the hash of the text it
// belongs to, and once a bot or a person changes that cell the copy no longer shows. Bots and /v1 never read this table.
import { and, eq, inArray } from "drizzle-orm";
import { sha256 } from "./crypto";
import type { Db } from "./db";
import { leadRichText } from "./db/schema";
import { cleanRich } from "./rich-clean";
import { MAX_RICH, RICH_FIELDS } from "./rich-text";

export type RichRow = { field: string; html: string; plainHash: string };
const hashOf = (v: unknown) => sha256(typeof v === "string" ? v.trim() : "");

export const richRows = (db: Db, tenantId: string, leadId: string): Promise<RichRow[]> =>
  db.select({ field: leadRichText.field, html: leadRichText.html, plainHash: leadRichText.plainHash }).from(leadRichText).where(and(eq(leadRichText.tenantId, tenantId), eq(leadRichText.leadId, leadId)));

/** The copies that still match their cells, field by field. */
export function richFor(rows: RichRow[], lead: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of rows) {
    if (!RICH_FIELDS.has(r.field) || r.plainHash !== hashOf(lead[r.field])) continue;
    const html = cleanRich(r.html);
    if (html) out[r.field] = html;
  }
  return out;
}

/** What a save asked for: a formatted copy per field (null to drop it), cleaned. Anything but a known long cell is ignored. */
export function readRich(input: unknown): { ok: true; wanted: Record<string, string | null> } | { ok: false; error: string } {
  const wanted: Record<string, string | null> = {};
  if (!input || typeof input !== "object") return { ok: true, wanted };
  for (const [k, v] of Object.entries(input)) {
    if (!RICH_FIELDS.has(k) || (typeof v !== "string" && v !== null)) continue;
    if (typeof v === "string" && v.length > MAX_RICH) return { ok: false, error: "This document is too long to keep its formatting. Paste a shorter part." };
    wanted[k] = v === null ? null : cleanRich(v) || null;
  }
  return { ok: true, wanted };
}

/** After the cell was written: stores each copy against the text the cell now holds. A field that was refused, or that holds other
 *  text than the one sent, keeps no copy from this save. Answers what the page should now show for those fields. */
export async function saveRich(db: Db, tenantId: string, leadId: string, userId: string, wanted: Record<string, string | null>, sent: Record<string, unknown>, lead: Record<string, unknown>, refused: string[] = []): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  const drop: string[] = [];
  for (const [field, html] of Object.entries(wanted)) {
    if (refused.includes(field)) continue;
    const held = typeof lead[field] === "string" ? (lead[field] as string) : "";
    const same = held.trim() === (typeof sent[field] === "string" ? (sent[field] as string).trim() : "");
    if (!html || !held.trim() || !same) {
      drop.push(field);
      out[field] = null;
      continue;
    }
    const row = { html, plainHash: hashOf(held), userId, updatedAt: new Date() };
    await db.insert(leadRichText).values({ leadId, tenantId, field, ...row }).onConflictDoUpdate({ target: [leadRichText.leadId, leadRichText.field], set: row });
    out[field] = html;
  }
  if (drop.length) await db.delete(leadRichText).where(and(eq(leadRichText.tenantId, tenantId), eq(leadRichText.leadId, leadId), inArray(leadRichText.field, drop)));
  return out;
}
