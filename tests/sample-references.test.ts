// A marked site acts as a reference for future sites, and the owner can toggle that mark: the owner's Reference mark on an approved or live sample, pinned to its version, with who, when and the family
// (from the lead, changeable), more than one allowed, removable, kept in the tenant's settings beside its other settings,
// and the list the engine reads (GET /v1/samples/references: {references: [{sampleId, leadId, family, version, setAt,
// setBy}], updatedAt}).
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { clearReference, parseReferences, references, setReference, setReferenceFamily } from "@/lib/sample-references";
import { deleteSample, reviewSample, saveDraft, sampleFooter } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";
import { askAsPerson } from "./helpers/person-request";

const NOMAP = async () => "";
const page = (name: string, body: string) => `<!doctype html><html lang="en"><head><title>${name}</title></head><body><h1>${name}</h1>${body}${sampleFooter(name, "")}</body></html>`;
const BOT: Actor = { kind: "bot", name: "Lead Enricher", via: "engine" };

async function setup() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  await db.update(tenants).set({ settings: { ownPlaces: ["Main St"] } }).where(eq(tenants.id, tenant.id));
  const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const sample = async (business: string, industry: string, listing = "") => {
    const r = await writeLead(db, tenant.id, {}, { business, industry, location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website", ...(listing ? { listing_evidence: listing } : {}) }, OLU, { create: true });
    if (!r.ok) throw new Error(r.message);
    const lead = String(r.lead.id);
    const s = await saveDraft(db, tenant.id, lead, "eat", undefined, "Site Builder", NOMAP, { html: page(business, "<p>v1</p>") });
    return { lead, id: s.id };
  };
  return { db, t: tenant.id, sample };
}

describe("the Reference mark", () => {
  it("only on an approved or live sample; pinned to its version, with who, when and the family from the lead", async () => {
    const { db, t, sample } = await setup();
    const a = await sample("Gamma Grill", "Korean barbecue restaurant");
    await expect(setReference(db, t, a.id, "Olu")).rejects.toThrow(/only an approved or live sample/);
    await reviewSample(db, t, a.id, "approve", { name: "Olu" });
    const r = await setReference(db, t, a.id, "Olu");
    expect(r).toMatchObject({ sampleId: a.id, leadId: a.lead, version: 1, family: "eat", setBy: "Olu" });
    expect(Date.parse(r.setAt)).toBeGreaterThan(0);
    // the tenant's other settings stay
    const [row] = await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, t));
    expect(row.s.ownPlaces).toEqual(["Main St"]);
    await expect(setReference(db, t, "00000000-0000-4000-8000-000000000000", "Olu")).rejects.toThrow(/no such sample/);
  });

  it("the family is changeable, more than one may exist, a mark comes off, and a gone sample leaves the list", async () => {
    const { db, t, sample } = await setup();
    const a = await sample("Gamma Grill", "Restaurant");
    const b = await sample("Mina Alterations", "Clothing store", "4.9★ (746 reviews), Tailor, Clothing store, open 6 days");
    for (const s of [a, b]) await reviewSample(db, t, s.id, "approve", { name: "Olu" });
    await setReference(db, t, a.id, "Olu");
    expect((await setReference(db, t, b.id, "Olu")).family).toBe("services"); // the listing's first category, a tailor
    await expect(setReferenceFamily(db, t, a.id, "bakery")).rejects.toThrow(/one of eat, shop/);
    expect((await setReferenceFamily(db, t, a.id, "shop")).family).toBe("shop");
    expect((await references(db, t)).references.map((r) => [r.sampleId, r.family])).toEqual([[a.id, "shop"], [b.id, "services"]]);
    await clearReference(db, t, a.id);
    await expect(clearReference(db, t, a.id)).rejects.toThrow(/not a reference/);
    expect((await references(db, t)).references.map((r) => r.sampleId)).toEqual([b.id]);
    await reviewSample(db, t, b.id, "takedown", { name: "Olu" });
    await deleteSample(db, t, b.id, "Olu", async () => {});
    const left = await references(db, t);
    expect(left.references).toEqual([]);
    expect(Date.parse(left.updatedAt ?? "")).toBeGreaterThan(0);
  });

  it("a newer version never becomes the reference by itself; marking again moves the pin and keeps the family", async () => {
    const { db, t, sample } = await setup();
    const a = await sample("Gamma Grill", "Restaurant");
    await reviewSample(db, t, a.id, "approve", { name: "Olu" });
    await setReference(db, t, a.id, "Olu");
    await setReferenceFamily(db, t, a.id, "plain");
    await writeLead(db, t, { id: a.lead }, { siteFacts: { hours: "Mon-Sun 10-22" } }, BOT);
    const v2 = await saveDraft(db, t, a.lead, "eat", undefined, "Site Builder", NOMAP, { html: page("Gamma Grill", "<p>v2</p>"), answers: [await askAsPerson(db, t, a.id)] });
    expect(v2.version).toBe(2);
    expect((await references(db, t)).references[0].version).toBe(1);
    await reviewSample(db, t, a.id, "approve", { name: "Olu" });
    const moved = await setReference(db, t, a.id, "Olu");
    expect([moved.version, moved.family]).toEqual([2, "plain"]);
  });

  it("anything malformed in the stored list is left out; one entry per sample", () => {
    expect(parseReferences([{ sampleId: "a", version: 3, family: "eat" }, { sampleId: "a", version: 4, family: "eat" }, { sampleId: "b", version: "x", family: "eat" }, { sampleId: "c", version: 1, family: "bakery" }, null, "x"]))
      .toEqual([{ sampleId: "a", version: 3, family: "eat", setAt: "", setBy: "" }]);
    expect(parseReferences(undefined)).toEqual([]);
  });
});
