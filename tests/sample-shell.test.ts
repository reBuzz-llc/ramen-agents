// A lead's photos before its first page. The first upload makes a shell that holds them; a
// shell is shown nowhere a person looks, the lead stays in the Site Builder's queue, its first page fills the shell as
// version 1 with the photos, and a shell with no page after 7 days goes with its photos.
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { samples } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { draftCount, dropOldShells, listSamples, publishQueue, putLeadPhoto, reviewSample, sampleCards, sampleQueue, saveDraft, sampleFooter } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";
import { eq } from "drizzle-orm";

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);
const NOMAP = async () => "";
const page = (body: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1>${body}${sampleFooter("Gamma Grill", "")}</body></html>`;
const META = { guest: false, dish: "Bibimbap", by: "site helper" };

async function setup() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const mk = async (business: string, extra: Record<string, unknown> = {}) => {
    const r = await writeLead(db, tenant.id, {}, { business, industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website", ...extra }, OLU, { create: true });
    if (!r.ok) throw new Error(r.message);
    return r.lead.id;
  };
  const kept = new Map<string, Uint8Array>();
  const store = { put: async (k: string, b: Uint8Array) => void kept.set(k, b) };
  return { db, t: tenant.id, mk, kept, store };
}

describe("675: a shell holds a lead's photos until its first page", () => {
  it("the first upload makes a shell that no person sees; the lead stays in the queue; the first page fills it as version 1", async () => {
    const { db, t, mk, store } = await setup();
    const lead = await mk("Gamma Grill");
    const a = await putLeadPhoto(db, t, lead, "a.webp", WEBP, META, store);
    expect(a).toMatchObject({ shell: true, photos: [{ name: "a.webp", dish: "Bibimbap" }] });
    const b = await putLeadPhoto(db, t, lead, "b.webp", WEBP, META, store);
    expect(b).toMatchObject({ sampleId: a.sampleId, shell: true });
    expect(b.photos.map((p) => p.name)).toEqual(["a.webp", "b.webp"]);
    // nowhere a person looks
    expect((await sampleCards(db, t)).cards).toEqual([]);
    expect(await listSamples(db, t)).toEqual([]);
    expect(await draftCount(db, t)).toBe(0);
    expect((await publishQueue(db, t)).map((x) => x.id)).not.toContain(a.sampleId);
    await expect(reviewSample(db, t, a.sampleId, "approve", { name: "Olu" })).rejects.toThrow(/no such sample/);
    // the Site Builder can still find it by name
    expect((await listSamples(db, t, { status: ["shell"], leadId: lead })).map((x) => x.id)).toEqual([a.sampleId]);
    // the lead is still to make
    expect((await sampleQueue(db, t, 20, NOMAP)).find((q) => q.leadId === lead)).toMatchObject({ reason: "backlog", sampleId: null });
    // its first page fills the shell: the same row, version 1, a draft, its photos kept
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page('<img src="photos/a.webp" alt="Bibimbap">') });
    expect(s).toMatchObject({ id: a.sampleId, status: "draft", version: 1 });
    expect(s.photos.map((p) => p.name)).toEqual(["a.webp", "b.webp"]);
    expect((await sampleCards(db, t)).cards.map((c) => c.id)).toEqual([a.sampleId]);
    expect((await sampleQueue(db, t, 20, NOMAP)).find((q) => q.leadId === lead)).toBeUndefined();
    // later uploads go to the sample itself
    expect(await putLeadPhoto(db, t, lead, "c.webp", WEBP, META, store)).toMatchObject({ sampleId: a.sampleId, shell: false });
  });

  it("refused as a first page is, and a refused picture leaves no shell", async () => {
    const { db, t, mk, store } = await setup();
    const site = await mk("Has A Site", { website: "https://hasasite.example" });
    await expect(putLeadPhoto(db, t, site, "a.webp", WEBP, META, store)).rejects.toThrow(/has a website/);
    const lead = await mk("Gamma Grill");
    await expect(putLeadPhoto(db, t, lead, "a.webp", new Uint8Array([1, 2, 3]), META, store)).rejects.toThrow(/not a webp/);
    await expect(putLeadPhoto(db, t, lead, "a.webp", WEBP, META, null)).rejects.toThrow(/storage is not set up/);
    await expect(putLeadPhoto(db, t, "00000000-0000-4000-8000-000000000000", "a.webp", WEBP, META, store)).rejects.toThrow(/no such lead/);
    expect(await db.select().from(samples)).toEqual([]);
  });

  it("a shell with no page after 7 days goes with its photos; a younger one and a real sample stay", async () => {
    const { db, t, mk, store } = await setup();
    const old = await putLeadPhoto(db, t, await mk("Old Shell"), "a.webp", WEBP, META, store);
    const young = await putLeadPhoto(db, t, await mk("Young Shell"), "b.webp", WEBP, META, store);
    const real = await mk("Real Sample");
    await saveDraft(db, t, real, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    const now = new Date();
    await db.update(samples).set({ updatedAt: new Date(now.getTime() - 8 * 86_400_000) }).where(eq(samples.id, old.sampleId));
    await db.update(samples).set({ updatedAt: new Date(now.getTime() - 8 * 86_400_000) }).where(eq(samples.leadId, real));
    await db.update(samples).set({ updatedAt: new Date(now.getTime() - 6 * 86_400_000) }).where(eq(samples.id, young.sampleId));
    const removed: string[] = [];
    expect(await dropOldShells(db, t, now, async (k) => void removed.push(k))).toBe(1);
    expect(removed).toEqual([`samples/${old.sampleId}/photos/a.webp`]);
    const left = (await db.select({ id: samples.id }).from(samples)).map((r) => r.id);
    expect(left).toContain(young.sampleId);
    expect(left).not.toContain(old.sampleId);
    expect(left).toHaveLength(2);
  });
});
