import { describe, expect, it } from "vitest";
import { memoryDb, type Db } from "@/lib/db";
import { leads, samples } from "@/lib/db/schema";
import { ALL_CHECKS, dishChoices, fullViewKey, largestOf, photoViewKey, reopenUnseen, reviewPhotos, withChecks, withDish } from "@/lib/sample-photo-checks";
import type { SamplePhoto } from "@/lib/sample-photos";
import { putSamplePhoto, setPhotoChecks, setPhotoDish } from "@/lib/samples";
import { addUser, createTenant } from "@/lib/tenants";
import { eq } from "drizzle-orm";

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 40, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20, ...new Array(40).fill(1)]);
const BIG = new Uint8Array([...WEBP, ...new Array(400).fill(2)]);
const META = { guest: false, dish: "", by: "helper" };
const held = new Map<string, Uint8Array>();
const store = { put: async (key: string, b: Uint8Array) => void held.set(key, b) };
const entry = (name: string, bytes: number, over: Partial<SamplePhoto> = {}): SamplePhoto => ({ name, key: `k/${name}`, type: "image/webp", bytes, guest: false, dish: "", at: "2026-11-23T10:00:00.000Z", by: "x", ...over });

async function setup(facts: Record<string, unknown> = { offers: ["Galbi", "Bibimbap"], popular: [{ name: "galbi" }, { name: "Kimchi stew" }], menu: ["Cold noodles"] }) {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const member = await addUser(db, tenant.id, "m@acme.example", "Mina");
  const [l] = await db.insert(leads).values({ tenantId: tenant.id, business: "Gamma Grill", siteFacts: facts }).returning();
  const [s] = await db.insert(samples).values({ tenantId: tenant.id, leadId: l.id, template: "t", html: '<img src="photos/galbi.webp"><img src="photos/galbi-2x.webp">', status: "draft", version: 1, slug: "gamma" } as typeof samples.$inferInsert).returning();
  await putSamplePhoto(db, tenant.id, s.id, "galbi.webp", WEBP, META, store);
  await putSamplePhoto(db, tenant.id, s.id, "galbi-2x.webp", BIG, META, store);
  return { db, t: tenant.id, id: s.id, owner, member };
}
const photosOf = async (db: Db, id: string) => (await db.select({ p: samples.photos }).from(samples).where(eq(samples.id, id)))[0].p as SamplePhoto[];

describe("the full-size file (849)", () => {
  it("is the largest stored, whatever the name says", () => {
    expect(largestOf([entry("a-2x.webp", 10), entry("a.webp", 90)]).name).toBe("a.webp");
    const [r] = reviewPhotos([entry("a.webp", 10), entry("a-2x.webp", 90)], ["a.webp", "a-2x.webp"]);
    expect([r.file, r.full]).toEqual(["a.webp", "a-2x.webp"]);
  });

  it("uses the only file when there is no 2x", () => {
    expect(fullViewKey([entry("a.webp", 10)], "s", "a")).toBe("s:a.webp:2026-11-23T10:00:00.000Z");
  });

  it("records against the largest file, never a smaller copy", async () => {
    const { db, id } = await setup();
    const files = await photosOf(db, id);
    const big = files.find((p) => p.name === "galbi-2x.webp")!;
    const small = files.find((p) => p.name === "galbi.webp")!;
    expect(fullViewKey(files, id, "galbi")).toBe(photoViewKey(id, big));
    expect(fullViewKey(files, id, "galbi")).not.toBe(photoViewKey(id, small));
  });

  it("Accept needs no full-size look first", async () => {
    const { db, t, id } = await setup();
    expect((await setPhotoChecks(db, t, id, "galbi", ALL_CHECKS)).checks).toEqual(ALL_CHECKS);
    expect((await setPhotoChecks(db, t, id, "galbi", [])).checks).toEqual([]);
  });
});

describe("what a photo shows (854)", () => {
  it("offers the lead's own items once each: offers, popular, menu", () => {
    expect(dishChoices({ offers: ["Galbi", "Bibimbap"], popular: [{ name: "galbi" }, { name: "Kimchi  stew" }], menu: ["Cold noodles", 3, null] })).toEqual(["Galbi", "Bibimbap", "Kimchi stew", "Cold noodles"]);
    expect(dishChoices(null)).toEqual([]);
    expect(dishChoices({ offers: ["x".repeat(81)] })).toEqual([]);
  });

  it("sets one mark on every file of the photo, changeable, and none of these", async () => {
    const { db, t, id } = await setup();
    await setPhotoDish(db, t, id, "galbi", "Kimchi stew");
    expect((await photosOf(db, id)).map((p) => p.dish)).toEqual(["Kimchi stew", "Kimchi stew"]);
    await setPhotoDish(db, t, id, "galbi", "Galbi");
    expect((await photosOf(db, id)).map((p) => p.dish)).toEqual(["Galbi", "Galbi"]);
    await setPhotoDish(db, t, id, "galbi", null);
    const files = await photosOf(db, id);
    expect(files.map((p) => p.dish)).toEqual(["", ""]);
    expect(reviewPhotos(files, files.map((p) => p.name))[0].dishSet).toBe(true);
  });

  it("takes a name the person typed (11-24), plain text up to 80 characters", async () => {
    const { db, t, id } = await setup();
    expect(await setPhotoDish(db, t, id, "galbi", "  Pork   belly ")).toEqual({ dish: "Pork belly" });
    expect((await photosOf(db, id)).map((p) => p.dish)).toEqual(["Pork belly", "Pork belly"]);
    await expect(setPhotoDish(db, t, id, "galbi", "x".repeat(81))).rejects.toMatchObject({ status: 400 });
    await expect(setPhotoDish(db, t, id, "galbi", "<b>Galbi</b>")).rejects.toMatchObject({ status: 400 });
    await expect(setPhotoDish(db, t, id, "galbi", "Gal\u0007bi")).rejects.toMatchObject({ status: 400 });
    expect((await photosOf(db, id)).map((p) => p.dish)).toEqual(["Pork belly", "Pork belly"]);
  });

  it("refuses a photo that is not there, and a name that is not text", async () => {
    const { db, t, id } = await setup();
    await expect(setPhotoDish(db, t, id, "nope", "Galbi")).rejects.toMatchObject({ status: 404 });
    await expect(setPhotoDish(db, t, id, "galbi", 4)).rejects.toMatchObject({ status: 400 });
  });

  it("does not touch Accept", async () => {
    const { db, t, id } = await setup();
    await setPhotoChecks(db, t, id, "galbi", ALL_CHECKS);
    await setPhotoDish(db, t, id, "galbi", "Galbi");
    expect((await photosOf(db, id)).every((p) => p.checks?.length === 4)).toBe(true);
  });

  it("a replace without a dish keeps the mark; a new size inherits it; one sent marks the whole photo", async () => {
    const { db, t, id } = await setup();
    await setPhotoDish(db, t, id, "galbi", "Galbi");
    await putSamplePhoto(db, t, id, "galbi.webp", WEBP, META, store);
    expect((await photosOf(db, id)).map((p) => p.dish)).toEqual(["Galbi", "Galbi"]);
    await putSamplePhoto(db, t, id, "galbi-1x.webp", WEBP, META, store);
    expect((await photosOf(db, id)).find((p) => p.name === "galbi-1x.webp")?.dish).toBe("Galbi");
    await putSamplePhoto(db, t, id, "galbi.webp", WEBP, { ...META, dish: "Bibimbap" }, store);
    expect((await photosOf(db, id)).map((p) => p.dish)).toEqual(["Bibimbap", "Bibimbap", "Bibimbap"]);
  });

  it("a replace keeps a 'none of these' too", async () => {
    const { db, t, id } = await setup();
    await setPhotoDish(db, t, id, "galbi", null);
    await putSamplePhoto(db, t, id, "galbi.webp", WEBP, META, store);
    const files = await photosOf(db, id);
    expect(reviewPhotos(files, files.map((p) => p.name))[0]).toMatchObject({ dish: "", dishSet: true });
  });

  it("withDish leaves other photos alone", () => {
    const out = withDish([entry("a.webp", 1), entry("b.webp", 1, { dish: "Other" })], "a", "Galbi", "t");
    expect(out.map((p) => p.dish)).toEqual(["Galbi", "Other"]);
  });
});

describe("taking back an Accept made before the full-size check (849)", () => {
  const OLD = "2026-11-22T10:00:00.000Z";
  const CUT = "2026-11-23T13:00:00.000Z";
  const ok = (name: string, bytes: number, at = OLD) => entry(name, bytes, { checks: [...ALL_CHECKS], checkedAt: at });

  it("reopens a photo whose largest file is bigger than the card's, on all its files, keeping when it was accepted", () => {
    const r = reopenUnseen([ok("a.webp", 10), ok("a-2x.webp", 90)], CUT, "now");
    expect(r.bases).toEqual(["a"]);
    expect(r.photos.map((p) => [p.checks, p.checkedAt, p.reopenedAt, p.acceptedBefore])).toEqual([[undefined, undefined, "now", OLD], [undefined, undefined, "now", OLD]]);
    expect(reviewPhotos(r.photos, ["a.webp", "a-2x.webp"])[0]).toMatchObject({ checks: [], reopened: true });
  });

  it("leaves a single file, equal sizes, a later Accept, a rejected photo and an undecided one", () => {
    const photos = [
      ok("one.webp", 10),
      ok("same.webp", 50), ok("same-2x.webp", 50),
      ok("new.webp", 10, "2026-11-23T14:00:00.000Z"), ok("new-2x.webp", 90, "2026-11-23T14:00:00.000Z"),
      { ...ok("no.webp", 10), rejected: true }, { ...ok("no-2x.webp", 90), rejected: true },
      entry("open.webp", 10), entry("open-2x.webp", 90),
    ];
    const r = reopenUnseen(photos, CUT, "now");
    expect(r.bases).toEqual([]);
    expect(r.photos).toEqual(photos);
  });

  it("a new Accept ends it, and the time of the old one stays", () => {
    const { photos } = reopenUnseen([ok("a.webp", 10), ok("a-2x.webp", 90)], CUT, "now");
    const again = withChecks(photos, "a", [...ALL_CHECKS], "later");
    expect(again.every((p) => p.reopenedAt === undefined && p.acceptedBefore === OLD && p.checkedAt === "later")).toBe(true);
    const row = reviewPhotos(again, ["a.webp", "a-2x.webp"])[0];
    expect(row.checks).toEqual(ALL_CHECKS);
    expect(row.reopened).toBeUndefined();
  });
});
