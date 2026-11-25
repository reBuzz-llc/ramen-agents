// A photo on a live page may be replaced by the same picture with new tone and colour, and by nothing else.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { beforeAll, describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { samples, sampleRequests } from "@/lib/db/schema";
import { writeLead } from "@/lib/leads";
import { samePicture } from "@/lib/photo-same-picture";
import { ALL_CHECKS, reviewPhotos } from "@/lib/sample-photo-checks";
import type { SamplePhoto } from "@/lib/sample-photos";
import { photosRevOf, publishQueue, putSamplePhoto, restorePhotoOriginal, reviewSample, sampleFooter, samplePhotoBytes, saveDraft, setPhotoChecks, setPhotoDish, storageUse } from "@/lib/samples";
import { storage } from "@/lib/storage";
import { createTenant } from "@/lib/tenants";

const W = 900;
const H = 600;
function random(seed: number) {
  let s = seed;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}
/** A scene with shapes, edges and grain, so it has detail everywhere, as a photo does. */
async function scene(seed: number, w = W, h = H) {
  const r = random(seed);
  const c = () => Math.floor(40 + r() * 180);
  const shapes = Array.from({ length: 70 }, () => {
    const x = r() * w, y = r() * h, s = 15 + r() * 90, fill = `rgb(${c()},${c()},${c()})`;
    return r() > 0.5 ? `<circle cx="${x}" cy="${y}" r="${s}" fill="${fill}"/>` : `<rect x="${x}" y="${y}" width="${s * 1.6}" height="${s}" fill="${fill}" transform="rotate(${r() * 40} ${x} ${y})"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="rgb(${c()},${c()},${c()})"/>${shapes}</svg>`;
  const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i++) data[i] = Math.max(0, Math.min(255, data[i] + Math.round((r() - 0.5) * 10)));
  return sharp(data, { raw: { width: info.width, height: info.height, channels: info.channels } }).webp({ quality: 92 }).toBuffer();
}
const grade = (b: Buffer, gamma = 1.25, saturation = 1.15, brightness = 1.03) => sharp(b).gamma(gamma).modulate({ saturation, brightness }).webp({ quality: 84 }).toBuffer();
const patched = async (b: Buffer, size: number, other: Buffer) => sharp(b).composite([{ input: await sharp(other).resize(size, size).toBuffer(), left: 400, top: 250 }]).webp({ quality: 92 }).toBuffer();

let base: Buffer;
let other: Buffer;
beforeAll(async () => {
  process.env.FILES_DIR = mkdtempSync(path.join(tmpdir(), "peek-862-"));
  [base, other] = await Promise.all([scene(11), scene(29)]);
});

describe("the same-picture check", () => {
  it("takes a real grade: tone, warmth and saturation", async () => {
    for (const [g, s, l] of [[1.1, 1.05, 1], [1.25, 1.15, 1.03], [1.15, 1.1, 0.98]]) expect((await samePicture(base, await grade(base, g, s, l))).same).toBe(true);
  });
  it("takes the same file encoded again", async () => expect((await samePicture(base, await sharp(base).webp({ quality: 70 }).toBuffer())).same).toBe(true));
  it("refuses a crop, even a small one, scaled back to the same size", async () => {
    const crop = await sharp(base).extract({ left: 9, top: 6, width: W - 18, height: H - 12 }).resize(W, H, { fit: "fill" }).webp().toBuffer();
    expect(await samePicture(base, crop)).toMatchObject({ same: false, reason: expect.stringMatching(/part of the picture/) });
  });
  it("refuses a mirrored copy", async () => expect((await samePicture(base, await sharp(base).flop().webp().toBuffer())).same).toBe(false));
  it("refuses a different photo of the same size", async () => expect((await samePicture(base, other)).same).toBe(false));
  it("refuses another size", async () => expect(await samePicture(base, await sharp(base).resize(W - 2, H).webp().toBuffer())).toMatchObject({ same: false, reason: expect.stringMatching(/its size/) }));
  it("refuses an added object, graded or not", async () => {
    const edited = await patched(base, 40, other);
    expect((await samePicture(base, edited)).same).toBe(false);
    expect((await samePicture(base, await grade(edited))).same).toBe(false);
  });
  it("refuses a blurred-out patch", async () => {
    const blur = await sharp(base).extract({ left: 380, top: 240, width: 90, height: 90 }).blur(12).toBuffer();
    expect((await samePicture(base, await sharp(base).composite([{ input: blur, left: 380, top: 240 }]).webp({ quality: 92 }).toBuffer())).same).toBe(false);
  });
  it("calls anything unreadable a no", async () => expect((await samePicture(base, new Uint8Array([1, 2, 3]))).same).toBe(false));
});

async function liveSample(photoBytes: Buffer) {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const person = { kind: "person" as const, name: "Olu", userId: owner.id };
  const made = await writeLead(db, tenant.id, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, person, { create: true });
  if (!made.ok) throw new Error(made.message);
  const lead = String(made.lead.id);
  const page = (b: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1>${b}${sampleFooter("Gamma Grill", "")}</body></html>`;
  const NOMAP = async () => "";
  const first = await saveDraft(db, tenant.id, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
  const st = await storage();
  await putSamplePhoto(db, tenant.id, first.id, "a.webp", photoBytes, { guest: true, dish: "Galbi", by: "engine" }, st);
  const s = await saveDraft(db, tenant.id, lead, "eat", undefined, "Site Builder", NOMAP, { html: page('<img src="photos/a.webp" alt="a">') });
  await setPhotoChecks(db, tenant.id, s.id, "a", ALL_CHECKS);
  await reviewSample(db, tenant.id, s.id, "approve", { name: "Olu", userId: owner.id }, "", null);
  await db.update(samples).set({ status: "live", url: "https://x.pages.dev/gamma/", publishedAt: new Date() }).where(eq(samples.id, s.id));
  const row = async () => (await db.select().from(samples).where(eq(samples.id, s.id)))[0];
  const entry = async () => ((await row()).photos as SamplePhoto[])[0];
  const put = (b: Uint8Array, meta: Partial<{ guest: boolean; dish: string }> = {}) => putSamplePhoto(db, tenant.id, s.id, "a.webp", b, { dish: "", by: "site-helper", ...meta }, st, new Date(Date.now() + 2000));
  return { db, t: tenant.id, id: s.id, row, entry, put };
}

describe("a grade-only replacement on a live sample", () => {
  it("replaces the file and changes nothing else: version, status, page, requests, marks and Accept", async () => {
    const x = await liveSample(base);
    const before = await x.row();
    const new1 = await grade(base);
    await x.put(new1);
    const after = await x.row();
    expect({ v: after.version, s: after.status, a: after.approvedVersion, h: after.html, u: after.updatedAt }).toEqual({ v: before.version, s: before.status, a: before.approvedVersion, h: before.html, u: before.updatedAt });
    expect(await x.db.select().from(sampleRequests).where(eq(sampleRequests.sampleId, x.id))).toEqual([]);
    const e = await x.entry();
    expect({ guest: e.guest, dish: e.dish, checks: e.checks, bytes: e.bytes, by: e.graded?.by }).toEqual({ guest: true, dish: "Galbi", checks: [...ALL_CHECKS], bytes: new1.length, by: "site-helper" });
    expect(Buffer.from((await samplePhotoBytes(x.db, x.t, x.id, "a.webp"))!.bytes).equals(new1)).toBe(true);
    expect(reviewPhotos([e], ["a.webp"])[0]).toMatchObject({ graded: true, checks: ALL_CHECKS });
  });

  it.each([
    ["a crop", async () => sharp(base).extract({ left: 9, top: 6, width: W - 18, height: H - 12 }).resize(W, H, { fit: "fill" }).webp().toBuffer()],
    ["a mirrored copy", async () => sharp(base).flop().webp().toBuffer()],
    ["another photo", async () => other],
    ["an added object", async () => patched(base, 40, other)],
    ["another size", async () => sharp(base).resize(W - 2, H).webp().toBuffer()],
  ])("refuses %s, says why, and leaves the file", async (_n, make) => {
    const x = await liveSample(base);
    const was = await x.entry();
    await expect(x.put(await make())).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/the approved version shows photos\/a\.webp.*only the same picture/) });
    expect(await x.entry()).toEqual(was);
    expect(Buffer.from((await samplePhotoBytes(x.db, x.t, x.id, "a.webp"))!.bytes).equals(base)).toBe(true);
  });

  it("refuses different marks, and takes the same ones", async () => {
    const x = await liveSample(base);
    const g = await grade(base);
    await expect(x.put(g, { dish: "Bibimbap" })).rejects.toThrow(/dish mark/);
    await expect(x.put(g, { guest: false })).rejects.toThrow(/guest mark/);
    await x.put(g, { dish: "Galbi", guest: true });
    expect((await x.entry()).graded).toBeTruthy();
  });

  it("opens nothing else: no new name on the page, no delete", async () => {
    const x = await liveSample(base);
    const { deleteSamplePhoto } = await import("@/lib/samples");
    await expect(deleteSamplePhoto(x.db, x.t, x.id, "a.webp", null)).rejects.toMatchObject({ status: 409 });
    await setPhotoDish(x.db, x.t, x.id, "a", "Galbi").catch(() => undefined);
    expect((await x.row()).status).toBe("live");
  });

  it("measures every later grade against the first original", async () => {
    const x = await liveSample(base);
    await x.put(await grade(base));
    const first = (await x.entry()).original;
    await x.put(await grade(base, 1.1, 1.05, 1));
    expect((await x.entry()).original).toEqual(first);
    await expect(x.put(await patched(await grade(base), 40, other))).rejects.toMatchObject({ status: 409 });
  });

  it("identical bytes again change nothing and leave the deploy hash alone", async () => {
    const x = await liveSample(base);
    const g = await grade(base);
    await x.put(g);
    const once = await x.entry();
    await x.put(g);
    expect(await x.entry()).toEqual(once);
  });

  it("counts the kept original in the storage line", async () => {
    const x = await liveSample(base);
    const before = (await storageUse(x.db, x.t)).sampleBytes;
    const g = await grade(base);
    await x.put(g);
    expect((await storageUse(x.db, x.t)).sampleBytes).toBe(before - base.length + g.length + base.length);
  });

  it("an owner or manager can put the original back, keeping the Accept and marks", async () => {
    const x = await liveSample(base);
    await x.put(await grade(base));
    expect(await restorePhotoOriginal(x.db, x.t, x.id, "a")).toEqual({ restored: 1 });
    const e = await x.entry();
    expect({ graded: e.graded, bytes: e.bytes, guest: e.guest, dish: e.dish, checks: e.checks }).toEqual({ graded: undefined, bytes: base.length, guest: true, dish: "Galbi", checks: [...ALL_CHECKS] });
    expect(Buffer.from((await samplePhotoBytes(x.db, x.t, x.id, "a.webp"))!.bytes).equals(base)).toBe(true);
    expect((await x.row()).status).toBe("live");
    await expect(restorePhotoOriginal(x.db, x.t, x.id, "a")).rejects.toMatchObject({ status: 409 });
  });
});

describe("what tells the publisher (photosRev)", () => {
  const p = (name: string, sha?: string) => ({ name, graded: sha ? { at: "t", by: "x", sha } : undefined }) as SamplePhoto;
  it("is empty with no graded file in use", () => {
    expect(photosRevOf([p("a.webp"), p("b.webp", "s")], ['<img src="photos/a.webp">'])).toBe("");
  });
  it("depends on names and bytes, in a fixed order", () => {
    const one = photosRevOf([p("a.webp", "1"), p("b.webp", "2")], ['photos/a.webp photos/b.webp']);
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(photosRevOf([p("b.webp", "2"), p("a.webp", "1")], ['photos/b.webp photos/a.webp'])).toBe(one);
    expect(photosRevOf([p("a.webp", "1"), p("b.webp", "3")], ['photos/a.webp photos/b.webp'])).not.toBe(one);
  });
  it("is on the publish item, and goes back to empty after a restore", async () => {
    const x = await liveSample(base);
    const rev = async () => (await publishQueue(x.db, x.t, new Date(), async () => "https://x/1")).find((i) => i.id === x.id)?.photosRev;
    expect(await rev()).toBe("");
    await x.put(await grade(base));
    expect(await rev()).toMatch(/^[0-9a-f]{64}$/);
    await restorePhotoOriginal(x.db, x.t, x.id, "a");
    expect(await rev()).toBe("");
  });
});
