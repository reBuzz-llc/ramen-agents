// Part B of an independent read of Peek: leftovers and races on the samples path. B5 the shell sweep, B6
// the photo list under the row's lock and one shell per lead, B7 a request checked before its pictures are stored, B8
// Delete takes every version's copies and the requests' pictures, B9 the truthful words, B12 settings under the lock,
// B13 an expiry keeps a waiting draft in review, B14 a mark goes when its sample comes down.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { sampleRequests, sampleVersions, samples, tenants } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { decisionMessage } from "@/lib/sample-labels";
import { references, setReference } from "@/lib/sample-references";
import { addSampleRequest } from "@/lib/sample-requests";
import { deleteSample, dropOldShells, publishQueue, putLeadPhoto, putSamplePhoto, reportPublish, reviewOf, reviewSample, saveDraft, sampleFooter, type SampleCard } from "@/lib/samples";
import { createTenant, settingsOf, updateSettings } from "@/lib/tenants";
import { askAsPerson } from "./helpers/person-request";

const NOMAP = async () => "";
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const page = (body: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1>${body}${sampleFooter("Gamma Grill", "")}</body></html>`;
const META = { guest: false, dish: "", by: "site helper" };
const DAY = 86_400_000;

async function setup() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const mk = async (business: string) => {
    const r = await writeLead(db, tenant.id, {}, { business, industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, OLU, { create: true });
    if (!r.ok) throw new Error(r.message);
    return r.lead.id;
  };
  return { db, t: tenant.id, mk, OLU, store: { put: async () => {} } };
}

describe("703 B5: the shell sweep", () => {
  it("counts 7 days from the last upload, and a shell filled by a page keeps its files", async () => {
    const { db, t, mk, store } = await setup();
    const now = Date.now();
    const busy = await putLeadPhoto(db, t, await mk("Busy Shell"), "a.webp", WEBP, META, store);
    const filledLead = await mk("Filled Shell");
    const filled = await putLeadPhoto(db, t, filledLead, "b.webp", WEBP, META, store);
    await saveDraft(db, t, filledLead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    // made 10 days ago, last upload 2 days ago: stays
    await db.update(samples).set({ createdAt: new Date(now - 10 * DAY), updatedAt: new Date(now - 2 * DAY) }).where(eq(samples.id, busy.sampleId));
    await db.update(samples).set({ createdAt: new Date(now - 10 * DAY), updatedAt: new Date(now - 10 * DAY) }).where(eq(samples.id, filled.sampleId));
    const removed: string[] = [];
    expect(await dropOldShells(db, t, new Date(now), async (k) => void removed.push(k))).toBe(0);
    expect(removed).toEqual([]);
    await db.update(samples).set({ updatedAt: new Date(now - 8 * DAY) }).where(eq(samples.id, busy.sampleId));
    expect(await dropOldShells(db, t, new Date(now), async (k) => void removed.push(k))).toBe(1);
    expect(removed).toEqual([`samples/${busy.sampleId}/photos/a.webp`]);
  });
});

describe("703 B6: the photo list under the row's lock", () => {
  it("parallel uploads keep every entry; parallel first uploads make one shell", async () => {
    const { db, t, mk, store } = await setup();
    const lead = await mk("Gamma Grill");
    const firsts = await Promise.all(["a", "b", "c"].map((n) => putLeadPhoto(db, t, lead, `${n}.webp`, WEBP, META, store)));
    expect(new Set(firsts.map((f) => f.sampleId)).size).toBe(1);
    expect((await db.select().from(samples).where(eq(samples.leadId, lead))).length).toBe(1);
    const id = firsts[0].sampleId;
    await Promise.all(["d", "e", "f", "g"].map((n) => putSamplePhoto(db, t, id, `${n}.webp`, WEBP, META, store)));
    const [row] = await db.select({ photos: samples.photos }).from(samples).where(eq(samples.id, id));
    expect(row.photos.map((p) => p.name).sort()).toEqual(["a.webp", "b.webp", "c.webp", "d.webp", "e.webp", "f.webp", "g.webp"]);
  });

  it("an upload to a shell removed meanwhile answers 404, not a success", async () => {
    const { db, t, mk, store } = await setup();
    const s = await putLeadPhoto(db, t, await mk("Gone Shell"), "a.webp", WEBP, META, store);
    let first = true;
    const racing = { put: async () => { if (first) { first = false; await db.delete(samples).where(eq(samples.id, s.sampleId)); } } };
    await expect(putSamplePhoto(db, t, s.sampleId, "b.webp", WEBP, META, racing)).rejects.toMatchObject({ status: 404 });
  });
});

describe("703 B7: a change request is checked before its pictures are stored", () => {
  it("a rejected or unknown sample, or an empty text, stores no picture", async () => {
    const { db, t, mk } = await setup();
    const s = await saveDraft(db, t, await mk("Gamma Grill"), "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    await reviewSample(db, t, s.id, "reject", { name: "Olu" }, "not this one");
    const stored: string[] = [];
    const store = { put: async (k: string) => void stored.push(k) };
    const encode = async (b: Uint8Array) => b;
    await expect(addSampleRequest(db, t, s.id, { text: "Bigger hours", byName: "Olu", pictures: [PNG] }, store, encode)).rejects.toMatchObject({ status: 409 });
    await expect(addSampleRequest(db, t, "00000000-0000-4000-8000-000000000000", { text: "x", byName: "Olu", pictures: [PNG] }, store, encode)).rejects.toMatchObject({ status: 404 });
    await expect(addSampleRequest(db, t, s.id, { text: "  ", byName: "Olu", pictures: [PNG] }, store, encode)).rejects.toMatchObject({ status: 400 });
    expect(stored).toEqual([]);
  });
});

describe("703 B8: Delete takes every file of the sample", () => {
  it("every version's Approve copies, its photos and its requests' pictures", async () => {
    const { db, t, mk, store } = await setup();
    const lead = await mk("Gamma Grill");
    const sh = await putLeadPhoto(db, t, lead, "a.webp", WEBP, META, store);
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    const copy = (key: string) => ({ src: "https://x", path: "assets/1.jpg", key, type: "image/jpeg" });
    await db.update(samples).set({ assets: [copy(`samples/${s.id}/v2/1.jpg`)] }).where(eq(samples.id, s.id));
    await db.insert(sampleVersions).values({ tenantId: t, sampleId: s.id, version: 1, template: "eat", html: "", madeAt: new Date(), assets: [copy(`samples/${s.id}/v1/1.jpg`)] });
    await addSampleRequest(db, t, s.id, { text: "Bigger hours", byName: "Olu", pictures: [PNG] }, store, async (b) => b);
    const [q] = await db.select().from(sampleRequests).where(eq(sampleRequests.sampleId, s.id));
    await reviewSample(db, t, s.id, "takedown", { name: "Olu" });
    const removed: string[] = [];
    const r = await deleteSample(db, t, sh.sampleId, "Olu", async (k) => void removed.push(k));
    expect(removed.sort()).toEqual([`samples/${s.id}/photos/a.webp`, `samples/${s.id}/requests/${q.id}/1.png`, `samples/${s.id}/v1/1.jpg`, `samples/${s.id}/v2/1.jpg`].sort());
    expect(r.files).toBe(4);
  });
});

describe("703 B9: the words say what really happens", () => {
  const card = (over: Partial<SampleCard> = {}): SampleCard => ({
    id: "s", leadId: "l", business: "Gamma Grill", area: "Astoria, NY", trade: "Restaurant", template: "eat", status: "approved", version: 2, draftedAt: "", draftedBy: "Site Builder",
    reviewedBy: "Olu", url: "", hold: false, frozen: false, note: "", leadHref: "/leads/l", kind: "page", changes: "", designReason: "", sources: [], open: "", pages: [], guestPhotos: [],
    approvedVersion: 2, requests: [], ...over,
  });
  const RUNNING = new Date(Date.now() - 4 * 60_000).toISOString();
  it("hold, a filled Website cell and a guest-photo wait come before any promise; running says when it last ran", () => {
    expect(reviewOf(card({ hold: true }), RUNNING).why).toBe("Approved, on hold: it stays off the web until someone releases it");
    expect(reviewOf(card({ status: "live", url: "https://x.pages.dev/g/", hold: true }), RUNNING).why).toBe("Live, on hold: it comes off the web until someone releases it");
    expect(reviewOf(card({ website: true }), RUNNING).why).toBe("Approved, but the business has a website now: it is not published");
    expect(reviewOf(card({ guestWait: true }), RUNNING)).toEqual({ group: "needs", why: "Approved by Settings, but it shows a guest's photo: it waits for a person's Approve" });
    expect(reviewOf(card(), RUNNING).why).toBe("Approved: it goes up on the publisher's next run (it last ran 4 min ago)");
    expect(decisionMessage("approve", { ...card(), website: true }, RUNNING)).toBe("Approved, but the business has a website now: a sample is only for one without, so it is not published.");
  });
});

describe("703 B12: settings are changed under the tenant row's lock", () => {
  it("a Settings form and a Reference mark at the same moment keep both", async () => {
    const { db, t, mk } = await setup();
    const s = await saveDraft(db, t, await mk("Gamma Grill"), "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    await reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null, 1);
    await Promise.all([updateSettings(db, t, () => ({ samplesAutoPublish: true })), setReference(db, t, s.id, "Olu"), updateSettings(db, t, () => ({ worldUrl: "https://world.example" }))]);
    const now = await settingsOf(db, t);
    expect(now).toMatchObject({ samplesAutoPublish: true, worldUrl: "https://world.example" });
    expect(now.sampleReferences?.map((r) => r.sampleId)).toEqual([s.id]);
    // a key set to undefined goes
    await updateSettings(db, t, () => ({ worldUrl: undefined }));
    expect("worldUrl" in (await settingsOf(db, t))).toBe(false);
  });
});

describe("703 B13 and B14: when the page comes down", () => {
  it("an expiry keeps a waiting draft and its requests in review; nothing approved is served", async () => {
    const { db, t, mk } = await setup();
    const s = await saveDraft(db, t, await mk("Gamma Grill"), "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    await reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null, 1);
    await reportPublish(db, t, s.id, "published", `https://x.pages.dev/${s.slug}/`);
    await reviewSample(db, t, s.id, "changes", { name: "Olu" }, "Bigger hours");
    const asked = await askAsPerson(db, t, s.id);
    await saveDraft(db, t, (await db.select({ l: samples.leadId }).from(samples).where(eq(samples.id, s.id)))[0].l, "eat", undefined, "site helper", NOMAP, { html: page("<p>v2</p>"), answers: [asked] });
    await db.update(samples).set({ publishedAt: new Date(Date.now() - 31 * DAY) }).where(eq(samples.id, s.id));
    const after = await reportPublish(db, t, s.id, "expired", "");
    // v2 answered one, so the other is still open and it stays with the builder
    expect(after).toMatchObject({ status: "changes_requested", version: 2, approvedVersion: null, url: "" });
    expect((await db.select().from(sampleRequests).where(eq(sampleRequests.sampleId, s.id))).length).toBe(2);
    expect((await publishQueue(db, t)).map((x) => x.id)).not.toContain(s.id);
  });

  it("a taken-down or rejected sample is no reference any more", async () => {
    const { db, t, mk } = await setup();
    const s = await saveDraft(db, t, await mk("Gamma Grill"), "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    await reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null, 1);
    await setReference(db, t, s.id, "Olu");
    expect((await references(db, t)).references).toHaveLength(1);
    await reviewSample(db, t, s.id, "takedown", { name: "Olu" });
    expect((await references(db, t)).references).toEqual([]);
    const [ten] = await db.select({ settings: tenants.settings }).from(tenants).where(eq(tenants.id, t));
    expect(ten.settings.sampleReferences).toEqual([]);
  });
});
