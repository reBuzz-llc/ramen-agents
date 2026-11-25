// Edited pictures for the menu's popular dishes: a sample's uploaded photos, photos/<name> on
// its page only when uploaded for it, the previews carrying them inline, publish as more of the slug's assets/, the guest
// photos listed for the person approving, and never auto-published with a guest's photo.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { checkPage } from "@/lib/sample-page";
import { ALL_CHECKS } from "@/lib/sample-photo-checks";
import { inlinePhotos, ownPhoto, photoAssets, photoAssetsForPage, photoRefs, sniff, uploadProblem, type SamplePhoto } from "@/lib/sample-photos";
import { deleteSample, deleteSamplePhoto, publishQueue, putSamplePhoto, reviewSample, sampleCards, saveDraft, sampleFooter, setPhotoChecks } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";
import { askAsPerson } from "./helpers/person-request";

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]);
const NOMAP = async () => "";
const page = (body: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1>${body}${sampleFooter("Gamma Grill", "")}</body></html>`;
const photo = (name: string, guest = false, dish = ""): SamplePhoto => ({ name, key: `k/${name}`, type: name.endsWith(".webp") ? "image/webp" : "image/jpeg", bytes: 10, guest, dish, at: "", by: "engine" });

describe("the pure parts", () => {
  it("the type from the bytes, never the name; the name, the size and the count are checked", () => {
    expect([sniff(WEBP), sniff(JPEG), sniff(PNG), sniff(new Uint8Array([1, 2, 3]))]).toEqual(["image/webp", "image/jpeg", "image/png", null]);
    expect(uploadProblem("bulgogi.webp", WEBP, [])).toBe("");
    expect(uploadProblem("Bulgogi.webp", WEBP, [])).toMatch(/lower-case/);
    expect(uploadProblem("bulgogi.webp", JPEG, [])).toBe("the bytes are image/jpeg, but the name ends .webp");
    expect(uploadProblem("x.png", new Uint8Array([1, 2, 3]), [])).toBe("the body is not a webp, jpeg or png picture");
    expect(uploadProblem("x.jpg", new Uint8Array(5 * 1024 * 1024 + 1).fill(0xff), [])).toMatch(/at most 5 MB/);
    const forty = Array.from({ length: 40 }, (_, i) => photo(`p${i}.webp`));
    expect(uploadProblem("p41.webp", WEBP, forty)).toBe("");   // 90 files a sample now (sample-photo-cap)
    expect(uploadProblem("p3.webp", WEBP, forty), "the same name replaces").toBe("");
  });
  it("a page's own photos, and their assets at publish", () => {
    expect(photoRefs('<img src="photos/a.webp"><img src="../photos/b.jpg"> photos/c.gif')).toEqual(["a.webp", "b.jpg"]);
    expect(ownPhoto("photos/a.webp", ["a.webp"], false)).toBe(true);
    expect(ownPhoto("../photos/a.webp", ["a.webp"], false)).toBe(false);
    expect(ownPhoto("../photos/a.webp", ["a.webp"], true)).toBe(true);
    expect(ownPhoto("photos/z.webp", ["a.webp"], false)).toBe(false);
    const a = photoAssets([photo("a.webp"), photo("unused.jpg"), photo("b.jpg")], ['<img src="photos/a.webp">', '<img src="../photos/b.jpg">'], 2);
    expect(a).toEqual([
      { src: "photos/a.webp", path: "assets/3.webp", key: "k/a.webp", type: "image/webp" },
      { src: "photos/b.jpg", path: "assets/4.jpg", key: "k/b.jpg", type: "image/jpeg" },
    ]);
    expect(photoAssetsForPage(a)[1]).toMatchObject({ src: "../photos/b.jpg", path: "../assets/4.jpg" });
  });
  it("a preview carries them inline; one that cannot be read, or reads as another type, is left as it was", async () => {
    const html = '<img src="photos/a.webp"><img src="photos/b.jpg"><img src="photos/c.webp">';
    const out = await inlinePhotos(html, [photo("a.webp"), photo("b.jpg"), photo("c.webp")], async (p) => (p.name === "a.webp" ? WEBP : p.name === "b.jpg" ? WEBP : null));
    expect(out).toContain(`src="data:image/webp;base64,${Buffer.from(WEBP).toString("base64")}"`);
    expect(out).toContain('src="photos/b.jpg"');
    expect(out).toContain('src="photos/c.webp"');
  });
  it("the page check takes photos/<name> only when it is on the sample's list", () => {
    const html = page('<img src="photos/bulgogi.webp" alt="Bulgogi">');
    expect(checkPage(html, {}, [], { names: ["bulgogi.webp"] }).ok).toBe(true);
    const no = checkPage(html, {}, [], { names: [] });
    expect(!no.ok && no.error).toMatch(/not one of this sample's photos: upload it first/);
    expect(checkPage(page('<img src="../photos/bulgogi.webp">'), {}, [], { names: ["bulgogi.webp"], extra: true }).ok).toBe(true);
  });
});

async function setup(autoPublish = false) {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  if (autoPublish) await db.update(tenants).set({ settings: { samplesAutoPublish: true } }).where(eq(tenants.id, tenant.id));
  const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const r = await writeLead(db, tenant.id, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, OLU, { create: true });
  if (!r.ok) throw new Error(r.message);
  const kept = new Map<string, Uint8Array>();
  const store = { put: async (k: string, b: Uint8Array) => void kept.set(k, b) };
  return { db, t: tenant.id, lead: String(r.lead.id), kept, store };
}

describe("a sample's photos, end to end", () => {
  it("uploaded once, kept across drafts, used on the page, published as more assets; the guest photo listed; delete refused while used", async () => {
    const { db, t, lead, kept, store } = await setup();
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    // a page pointing at a photo not uploaded yet is refused
    await expect(saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page('<img src="photos/bulgogi.webp">') })).rejects.toThrow(/upload it first/);
    expect(await putSamplePhoto(db, t, s.id, "bulgogi.webp", WEBP, { guest: false, dish: "Bulgogi", by: "engine" }, store)).toMatchObject([{ name: "bulgogi.webp", key: `samples/${s.id}/photos/bulgogi.webp`, guest: false, dish: "Bulgogi" }]);
    await putSamplePhoto(db, t, s.id, "galbi.jpg", JPEG, { guest: true, dish: "Galbi", by: "engine" }, store);
    await expect(putSamplePhoto(db, t, s.id, "bad.webp", JPEG, { guest: false, dish: "", by: "engine" }, store)).rejects.toThrow(/bytes are image\/jpeg/);
    await expect(putSamplePhoto(db, t, s.id, "x.webp", WEBP, { guest: false, dish: "", by: "engine" }, null)).rejects.toThrow(/storage is not set up/);
    expect([...kept.keys()]).toEqual([`samples/${s.id}/photos/bulgogi.webp`, `samples/${s.id}/photos/galbi.jpg`]);
    const v2 = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page('<img src="photos/bulgogi.webp" alt="Bulgogi"><img src="photos/galbi.jpg" alt="Galbi">') });
    expect(v2).toMatchObject({ version: 2, status: "draft" }); // the refused page made no version
    expect(v2.photos.map((p) => p.name)).toEqual(["bulgogi.webp", "galbi.jpg"]);
    // the card lists the guest's photo for the person approving
    expect((await sampleCards(db, t)).cards[0].guestPhotos).toEqual([{ name: "galbi.jpg", dish: "Galbi" }]);
    await expect(deleteSamplePhoto(db, t, s.id, "galbi.jpg", null)).rejects.toThrow(/current page uses photos\/galbi.jpg/);
    // a person checks each photo first
    await expect(reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null)).rejects.toThrow(/^2 photos still need Accept or Reject/);
    await setPhotoChecks(db, t, s.id, "bulgogi", ALL_CHECKS);
    await setPhotoChecks(db, t, s.id, "galbi", ALL_CHECKS);
    // approved by a person: published, the photos as assets/1.. beside index.html
    await reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null);
    const [item] = await publishQueue(db, t, new Date(), async (key) => `https://bucket.example/${key}?sig=1`);
    expect(item.html).toContain('src="assets/1.webp"');
    expect(item.html).toContain('src="assets/2.jpg"');
    expect(item.html).not.toContain("photos/");
    expect(item.assets).toEqual([
      { path: "assets/1.webp", url: `https://bucket.example/samples/${s.id}/photos/bulgogi.webp?sig=1` },
      { path: "assets/2.jpg", url: `https://bucket.example/samples/${s.id}/photos/galbi.jpg?sig=1` },
    ]);
    // a deleted sample's photo files go with it
    await reviewSample(db, t, s.id, "takedown", { name: "Olu" });
    const removed: string[] = [];
    await deleteSample(db, t, s.id, "Olu", async (k) => void removed.push(k));
    expect(removed).toEqual(expect.arrayContaining([`samples/${s.id}/photos/bulgogi.webp`, `samples/${s.id}/photos/galbi.jpg`]));
  });

  it("autoPublish never approves a page that shows a photo (750), a guest's or the business's own, and says why", async () => {
    const { db, t, lead, store } = await setup(true);
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    expect(s.status).toBe("approved");
    await putSamplePhoto(db, t, s.id, "own.webp", WEBP, { guest: false, dish: "Bibimbap", by: "engine" }, store);
    await putSamplePhoto(db, t, s.id, "guest.jpg", JPEG, { guest: true, dish: "Galbi", by: "engine" }, store);
    // an approved sample takes a new page once its facts change (stale): it waits for a person's checks
    const fresh = async (hours: string, html: string) => {
      await writeLead(db, t, { id: lead }, { siteFacts: { hours } }, { kind: "bot", name: "Lead Enricher", via: "engine" });
      return saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page(html), answers: [await askAsPerson(db, t, s.id)] });
    };
    const own = await fresh("Mon-Sun 10-22", '<img src="photos/own.webp">');
    expect(own.status).toBe("draft");
    expect(own.waits).toMatch(/a photo is on the page: a person checks it and approves/);
    const g = await fresh("Mon-Sun 11-23", '<img src="photos/guest.jpg">');
    expect(g.status).toBe("draft");
    expect(g.waits).toMatch(/a photo is on the page: a person checks it and approves/);
  });

  it("the publish queue keeps an auto-approved page with a guest's photo off the web", async () => {
    const { db, t, lead, store } = await setup(true);
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    await putSamplePhoto(db, t, s.id, "guest.jpg", JPEG, { guest: true, dish: "Galbi", by: "engine" }, store);
    // forced into the state the guard is for: auto-approved, using the guest's photo
    const { samples } = await import("@/lib/db/schema");
    await db.update(samples).set({ html: page('<img src="photos/guest.jpg">'), status: "approved" }).where(eq(samples.id, s.id));
    expect((await publishQueue(db, t, new Date(), async (k) => `https://bucket.example/${k}`)).map((i) => i.id)).not.toContain(s.id);
  });
});
