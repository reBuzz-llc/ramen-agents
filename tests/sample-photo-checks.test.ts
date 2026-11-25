// Photos are checked first: every photo a page uses gets four ticks before Approve. A tick says what was
// looked at, not that the photo is cleared forever: replacing a photo drops its ticks, and a new version asks only about new photos.
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { writeLead, type Actor } from "@/lib/leads";
import { ALL_CHECKS, cleanChecks, photoBase, photosLeft, reviewPhotos, withChecks } from "@/lib/sample-photo-checks";
import type { SamplePhoto } from "@/lib/sample-photos";
import { putSamplePhoto, reviewSample, sampleCards, sampleFooter, saveDraft, setPhotoChecks } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);
const NOMAP = async () => "";
const page = (body: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1>${body}${sampleFooter("Gamma Grill", "")}</body></html>`;
const entry = (name: string, bytes = 10, checks?: string[]) => ({ name, bytes, guest: false, dish: "", ...(checks ? { checks } : {}) });

describe("the pure parts", () => {
  it("a photo's sizes are one photo; only photos the page uses are listed", () => {
    expect(photoBase("galbi-2x.webp")).toBe("galbi");
    expect(photoBase("galbi.webp")).toBe("galbi");
    const rows = reviewPhotos([entry("galbi-2x.webp", 90), entry("galbi.webp", 40), entry("unused.webp")], ["galbi.webp", "galbi-2x.webp"]);
    expect(rows).toMatchObject([{ base: "galbi", file: "galbi.webp", full: "galbi-2x.webp", guest: false, dish: "", dishSet: false, checks: [] }]);
    expect(rows).toHaveLength(1);
  });

  it("a tick counts only when every used copy carries it, so one replaced copy reopens the photo", () => {
    const rows = reviewPhotos([entry("a.webp", 10, ALL_CHECKS), entry("a-2x.webp", 20)], ["a.webp", "a-2x.webp"]);
    expect(rows[0].checks).toEqual([]);
    expect(photosLeft(rows)).toBe(1);
  });

  it("only the four known checks are taken, in their order; no ticks clears them and their time", () => {
    expect(cleanChecks(["print", "people"])).toEqual(["people", "print"]);
    expect(cleanChecks(["people", "other"])).toBeNull();
    expect(cleanChecks("people")).toBeNull();
    const ticked = withChecks([entry("a.webp")], "a", ["people"], "2026-11-21T10:00:00Z");
    expect(ticked[0]).toMatchObject({ checks: ["people"], checkedAt: "2026-11-21T10:00:00Z" });
    const cleared = withChecks(ticked, "a", [], "2026-11-21T11:00:00Z");
    expect(cleared[0]).not.toHaveProperty("checks");
    expect(cleared[0]).not.toHaveProperty("checkedAt");
  });
});

async function setup() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const r = await writeLead(db, tenant.id, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, OLU, { create: true });
  if (!r.ok) throw new Error(r.message);
  return { db, t: tenant.id, lead: String(r.lead.id), store: { put: async () => {} } };
}
const META = { guest: true, dish: "Galbi", by: "engine" };

describe("the checks on a sample", () => {
  it("Approve waits for all four on every photo, then is one press; the ticks name nobody", async () => {
    const { db, t, lead, store } = await setup();
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    await putSamplePhoto(db, t, s.id, "a.webp", WEBP, META, store);
    await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page('<img src="photos/a.webp" alt="Galbi">') });
    expect(await setPhotoChecks(db, t, s.id, "a", ["people", "plates", "screens"])).toEqual({ checks: ["people", "plates", "screens"], left: 1 });
    await expect(reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^1 photo still needs Accept or Reject/) });
    expect((await setPhotoChecks(db, t, s.id, "a", ALL_CHECKS)).left).toBe(0);
    const done = await reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null);
    expect(done.status).toBe("approved");
    const kept = (done.photos as SamplePhoto[]).find((p) => p.name === "a.webp")!;
    expect(Object.keys(kept)).not.toContain("checkedBy");
    expect(kept.checks).toEqual(ALL_CHECKS);
  });

  it("replacing a photo drops its ticks; a new version asks only about the photos it adds", async () => {
    const { db, t, lead, store } = await setup();
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    await putSamplePhoto(db, t, s.id, "a.webp", WEBP, META, store);
    await putSamplePhoto(db, t, s.id, "b.webp", WEBP, META, store);
    await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page('<img src="photos/a.webp" alt="A">') });
    await setPhotoChecks(db, t, s.id, "a", ALL_CHECKS);
    await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page('<img src="photos/a.webp" alt="A"><img src="photos/b.webp" alt="B">') });
    let card = (await sampleCards(db, t)).cards[0];
    expect(card.photoChecks?.map((p) => [p.base, p.checks.length])).toEqual([["a", 4], ["b", 0]]);
    await putSamplePhoto(db, t, s.id, "a.webp", WEBP, META, store);
    card = (await sampleCards(db, t)).cards[0];
    expect(card.photoChecks?.find((p) => p.base === "a")?.checks).toEqual([]);
  });

  it("refuses an unknown check, a photo not on the sample, and a dead sample", async () => {
    const { db, t, lead, store } = await setup();
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    await putSamplePhoto(db, t, s.id, "a.webp", WEBP, META, store);
    await expect(setPhotoChecks(db, t, s.id, "a", ["nope"])).rejects.toMatchObject({ status: 400 });
    await expect(setPhotoChecks(db, t, s.id, "z", ALL_CHECKS)).rejects.toMatchObject({ status: 404 });
    await reviewSample(db, t, s.id, "reject", { name: "Olu" }, "no");
    await expect(setPhotoChecks(db, t, s.id, "a", ALL_CHECKS)).rejects.toMatchObject({ status: 409 });
  });
});
