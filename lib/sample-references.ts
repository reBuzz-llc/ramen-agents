// Reference sites: a marked site is the content floor later sites have to pass, while their design may differ, and the
// mark can be toggled. The owner marks an approved or live sample as a reference on the Samples page; the mark is pinned to
// the version shown when it was set (a later version never silently becomes the reference), carries who and when, and the
// business family it stands for: filled from the lead's trade and listing, changeable by the owner. More than one may
// exist. The engine reads them with its key (GET /v1/samples/references) and works out a content profile from each one's
// page and facts by code; the page's HTML and CSS never go to a member, and nothing here publishes anything.
// Stored in the tenant's settings (sampleReferences), so no migration: [{sampleId, version, family, setAt, setBy}].
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "./db";
import { leads, samples, tenants } from "./db/schema";
import { FAMILIES, familyOf, listingFacts, pickFamily, SampleError, type Family } from "./samples";

export type StoredReference = { sampleId: string; version: number; family: Family; setAt: string; setBy: string };
export type SampleReference = StoredReference & { leadId: string };
/** A sample may be marked when a person has approved it (approved, or live on the web). */
export const REFERENCE_STATUSES = ["approved", "live"];

/** The stored marks, anything malformed left out, one per sample. */
export function parseReferences(raw: unknown): StoredReference[] {
  const seen = new Set<string>();
  return (Array.isArray(raw) ? raw : []).flatMap((r): StoredReference[] => {
    const o = (r && typeof r === "object" ? r : {}) as Record<string, unknown>;
    const fam = familyOf(o.family);
    if (typeof o.sampleId !== "string" || seen.has(o.sampleId) || !Number.isInteger(o.version) || !fam) return [];
    seen.add(o.sampleId);
    return [{ sampleId: o.sampleId, version: Number(o.version), family: fam, setAt: String(o.setAt ?? ""), setBy: String(o.setBy ?? "") }];
  });
}

async function stored(d: Db, tenantId: string) {
  const [t] = await d.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId));
  const s = (t?.settings ?? {}) as Record<string, unknown>;
  return { list: parseReferences(s.sampleReferences), updatedAt: typeof s.sampleReferencesAt === "string" ? s.sampleReferencesAt : null };
}

/** The references, each with its lead; a mark whose sample is gone is left out. */
export async function references(d: Db, tenantId: string): Promise<{ references: SampleReference[]; updatedAt: string | null }> {
  const { list, updatedAt } = await stored(d, tenantId);
  if (!list.length) return { references: [], updatedAt };
  const rows = await d.select({ id: samples.id, leadId: samples.leadId }).from(samples).where(and(eq(samples.tenantId, tenantId), inArray(samples.id, list.map((r) => r.sampleId))));
  const lead = new Map(rows.map((r) => [r.id, r.leadId]));
  return { references: list.filter((r) => lead.has(r.sampleId)).map((r) => ({ ...r, leadId: lead.get(r.sampleId)! })), updatedAt };
}

/** Write the marks under the tenant row's lock (two clicks never lose one). */
async function change(d: Db, tenantId: string, fn: (list: StoredReference[]) => StoredReference[]): Promise<StoredReference[]> {
  return d.transaction(async (tx) => {
    const [t] = await tx.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, tenantId)).for("update");
    const s = (t?.settings ?? {}) as Record<string, unknown>;
    const next = fn(parseReferences(s.sampleReferences));
    await tx.update(tenants).set({ settings: { ...s, sampleReferences: next, sampleReferencesAt: new Date().toISOString() } }).where(eq(tenants.id, tenantId));
    return next;
  });
}

/** Mark a sample as a reference at the version it has now (marking it again moves the pin to the version shown). The
 *  family: the one given, else the one it already had, else picked from the lead's trade and listing. */
export async function setReference(d: Db, tenantId: string, sampleId: string, by: string, family?: unknown): Promise<SampleReference> {
  const [s] = await d.select({ id: samples.id, leadId: samples.leadId, status: samples.status, version: samples.version, approvedVersion: samples.approvedVersion, industry: leads.industry, listingEvidence: leads.listingEvidence })
    .from(samples).innerJoin(leads, eq(leads.id, samples.leadId)).where(and(eq(samples.tenantId, tenantId), eq(samples.id, sampleId)));
  if (!s) throw new SampleError(404, "no such sample");
  // the mark follows the approved version -- markable whenever one is approved (also while a newer draft waits),
  // and pinned to it, never to a draft's version
  const pin = ["taken_down", "rejected"].includes(s.status) ? null : (s.approvedVersion ?? (REFERENCE_STATUSES.includes(s.status) ? s.version : null));
  if (pin === null) throw new SampleError(409, `only an approved or live sample can be a reference; this one is ${s.status.replace("_", " ")}`);
  const asked = family === undefined || family === null || family === "" ? null : familyOf(family);
  if (family !== undefined && family !== null && family !== "" && !asked) throw new SampleError(400, `the family is one of ${FAMILIES.join(", ")}`);
  let out: StoredReference | undefined;
  await change(d, tenantId, (list) => {
    const had = list.find((r) => r.sampleId === sampleId);
    out = { sampleId, version: pin, family: asked ?? had?.family ?? pickFamily(s.industry, listingFacts(s.listingEvidence).kind), setAt: new Date().toISOString(), setBy: by };
    return [...list.filter((r) => r.sampleId !== sampleId), out];
  });
  return { ...out!, leadId: s.leadId };
}

/** Change only the family a reference stands for (the pin and who set it stay). */
export async function setReferenceFamily(d: Db, tenantId: string, sampleId: string, family: unknown): Promise<StoredReference> {
  const fam = familyOf(family);
  if (!fam) throw new SampleError(400, `the family is one of ${FAMILIES.join(", ")}`);
  let out: StoredReference | undefined;
  await change(d, tenantId, (list) => list.map((r) => (r.sampleId === sampleId ? (out = { ...r, family: fam }) : r)));
  if (!out) throw new SampleError(404, "this sample is not a reference");
  return out;
}

/** Take the mark off. */
export async function clearReference(d: Db, tenantId: string, sampleId: string): Promise<void> {
  let had = false;
  await change(d, tenantId, (list) => list.filter((r) => (r.sampleId === sampleId ? !(had = true) : true)));
  if (!had) throw new SampleError(404, "this sample is not a reference");
}
