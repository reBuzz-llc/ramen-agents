// Part A of an independent read of Peek: nothing reaches the web that a person (or Settings'
// auto-approve) did not approve. A1 Approve is for the version the person saw; A2 a photo the approved version shows is
// frozen; A3 such a photo is not deleted; A4 a facts re-render of an approved template sample waits like any new version.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { samples, tenants } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { ALL_CHECKS } from "@/lib/sample-photo-checks";
import { deleteSamplePhoto, publishQueue, putLeadPhoto, putSamplePhoto, reviewSample, saveDraft, sampleFooter, setPhotoChecks } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";
import { askAsPerson } from "./helpers/person-request";

const NOMAP = async () => "";
const PHOTO = "https://lh3.googleusercontent.com/p/abc=w800";
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);
const page = (body: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1>${body}${sampleFooter("Gamma Grill", "")}</body></html>`;
const V3 = { headline: "Fresh tacos, made to order", about: "A neighbourhood taqueria with tacos, burritos and aguas frescas, open every day.", cta: "Message us on WhatsApp" };
const META = { guest: false, dish: "", by: "site helper" };
const picture = async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });

async function setup() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const r = await writeLead(db, tenant.id, {}, { business: "Gamma Grill", industry: "Mexican restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website",
    listing_evidence: "Google listing: 4.6★ (212 reviews), Mexican restaurant, open 7 days" }, OLU, { create: true });
  if (!r.ok) throw new Error(r.message);
  return { db, t: tenant.id, lead: r.lead.id, OLU, store: { put: async () => {} } };
}

describe("703 A1: an Approve is for the version the person saw", () => {
  it("a newer page that replaced the waiting draft is not approved by a click made on the older one", async () => {
    const { db, t, lead } = await setup();
    const v1 = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    const v2 = await saveDraft(db, t, lead, "eat", undefined, "site helper", NOMAP, { html: page("<p>v2</p>") });
    expect(v2).toMatchObject({ id: v1.id, version: 2, status: "draft" });
    await expect(reviewSample(db, t, v1.id, "approve", { name: "Olu" }, "", null, 1)).rejects.toThrow(/a newer version arrived \(version 2; you looked at version 1\)/);
    expect((await publishQueue(db, t)).map((x) => x.id)).not.toContain(v1.id);
    expect(await reviewSample(db, t, v1.id, "approve", { name: "Olu" }, "", null, 2)).toMatchObject({ status: "approved", approvedVersion: 2 });
  });

  it("a picture from outside is refused before anything is stored (750): nothing is approved", async () => {
    const { db, t, lead } = await setup();
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page(`<img src="${PHOTO}" alt="tacos"><p>v1</p>`) });
    let wrote = 0;
    const put = async () => void wrote++;
    await expect(reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", { put, get: picture as unknown as typeof fetch }, 1)).rejects.toThrow(/not uploaded through Peek/);
    expect(wrote).toBe(0);
    const [row] = await db.select().from(samples).where(eq(samples.id, s.id));
    expect(row).toMatchObject({ status: "draft", version: 1, approvedVersion: null, assets: [] });
  });

  it("an approved or live row ahead of its approved version serves the approved version's page", async () => {
    const { db, t, lead } = await setup();
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>the approved one</p>") });
    await reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null, 1);
    await saveDraft(db, t, lead, "eat", undefined, "site helper", NOMAP, { html: page("<p>not approved</p>"), answers: [await askAsPerson(db, t, s.id)] });
    // an older row that reads approved while its version moved on (what an older build let a re-render do)
    await db.update(samples).set({ status: "approved" }).where(eq(samples.id, s.id));
    const [item] = await publishQueue(db, t);
    expect(item).toMatchObject({ id: s.id, version: 1 });
    expect(item.html).toContain("the approved one");
    expect(item.html).not.toContain("not approved");
  });
});

describe("703 A2 and A3: the photos the approved version shows", () => {
  it("are frozen: the same name is refused while the approved version shows it; a new name is fine; a draft-only photo may be replaced", async () => {
    const { db, t, lead, store } = await setup();
    const shell = await putLeadPhoto(db, t, lead, "a.webp", WEBP, META, store);
    await putSamplePhoto(db, t, shell.sampleId, "draft-only.webp", WEBP, META, store);
    await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page('<img src="photos/a.webp" alt="tacos">') });
    await setPhotoChecks(db, t, shell.sampleId, "a", ALL_CHECKS);
    await reviewSample(db, t, shell.sampleId, "approve", { name: "Olu" }, "", null, 1);
    await saveDraft(db, t, lead, "eat", undefined, "site helper", NOMAP, { html: page('<img src="photos/draft-only.webp" alt="tacos">'), answers: [await askAsPerson(db, t, shell.sampleId)] });
    await expect(putSamplePhoto(db, t, shell.sampleId, "a.webp", WEBP, META, store)).rejects.toThrow(/the approved version shows photos\/a\.webp: upload the new picture under a new name/);
    await expect(putSamplePhoto(db, t, shell.sampleId, "a.webp", WEBP, { ...META, guest: true }, store)).rejects.toMatchObject({ status: 409 });
    expect((await putSamplePhoto(db, t, shell.sampleId, "a-new.webp", WEBP, META, store)).map((p) => p.name)).toContain("a-new.webp");
    expect((await putSamplePhoto(db, t, shell.sampleId, "draft-only.webp", WEBP, META, store)).length).toBe(3);
  });

  it("are not deleted while the approved version on the web shows them, even when the waiting draft does not", async () => {
    const { db, t, lead, store } = await setup();
    const shell = await putLeadPhoto(db, t, lead, "a.webp", WEBP, META, store);
    await putSamplePhoto(db, t, shell.sampleId, "unused.webp", WEBP, META, store);
    await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page('<img src="photos/a.webp" alt="tacos">') });
    await setPhotoChecks(db, t, shell.sampleId, "a", ALL_CHECKS);
    await reviewSample(db, t, shell.sampleId, "approve", { name: "Olu" }, "", null, 1);
    await saveDraft(db, t, lead, "eat", undefined, "site helper", NOMAP, { html: page("<p>no photos in this one</p>"), answers: [await askAsPerson(db, t, shell.sampleId)] });
    const removed: string[] = [];
    await expect(deleteSamplePhoto(db, t, shell.sampleId, "a.webp", async (k) => void removed.push(k))).rejects.toThrow(/the approved version on the web shows photos\/a\.webp/);
    expect(removed).toEqual([]);
    expect((await deleteSamplePhoto(db, t, shell.sampleId, "unused.webp", async (k) => void removed.push(k))).map((p) => p.name)).toEqual(["a.webp"]);
  });
});

describe("703 A4: a facts change on an approved template sample", () => {
  it("829: makes no new version; the approved one stays the one served", async () => {
    const { db, t, lead, OLU } = await setup();
    const s = await saveDraft(db, t, lead, undefined, V3, "Site Builder", NOMAP);
    await reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null, 1);
    await writeLead(db, t, { id: lead }, { listing_evidence: "Google listing: 4.6★ (212 reviews), Mexican restaurant, open 5 days" }, OLU);
    const [row] = await db.select().from(samples).where(eq(samples.id, s.id));
    expect(row).toMatchObject({ version: 1, status: "approved", approvedVersion: 1 });
    const [item] = await publishQueue(db, t);
    expect(item).toMatchObject({ id: s.id, version: 1 });
    expect(item.html).not.toContain("Open 5 days");
  });

  it("829: with Settings' auto-approve on, a facts change still makes no new version", async () => {
    const { db, t, lead, OLU } = await setup();
    await db.update(tenants).set({ settings: { samplesAutoPublish: true } }).where(eq(tenants.id, t));
    const s = await saveDraft(db, t, lead, undefined, V3, "Site Builder", NOMAP);
    expect(s.status).toBe("approved");
    await writeLead(db, t, { id: lead }, { listing_evidence: "Google listing: 4.6★ (212 reviews), Mexican restaurant, open 5 days" }, OLU);
    const [row] = await db.select().from(samples).where(eq(samples.id, s.id));
    expect(row).toMatchObject({ version: 1, status: "approved", approvedVersion: 1 });
  });
});
