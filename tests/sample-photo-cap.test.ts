// A gallery of more than 20 photos, each with its 2x copy and its jpeg fallback, fits one
// sample: 90 files and 30 MB a sample. At the photo editor's budgets 30 photos come to about 20 MB.
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { writeLead, type Actor } from "@/lib/leads";
import { PHOTOS_BYTES_MAX, PHOTOS_MAX, uploadProblem, type SamplePhoto } from "@/lib/sample-photos";
import { putSamplePhoto, saveDraft, sampleFooter } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";

const KB = 1024;
const webp = (bytes: number) => { const b = new Uint8Array(bytes); b.set([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]); return b; };
const jpeg = (bytes: number) => { const b = new Uint8Array(bytes); b.set([0xff, 0xd8, 0xff, 0xe0]); return b; };
// the photo editor's three files for one photo, at its budgets (webp 1x 150 KB, webp 2x 350 KB, jpeg 180 KB)
const three = (i: number): [string, Uint8Array][] => [[`p${i}.webp`, webp(150 * KB)], [`p${i}-2x.webp`, webp(350 * KB)], [`p${i}.jpg`, jpeg(180 * KB)]];
const kept = (files: [string, Uint8Array][]): SamplePhoto[] =>
  files.map(([name, b]) => ({ name, key: `k/${name}`, type: name.endsWith(".jpg") ? "image/jpeg" : "image/webp", bytes: b.length, guest: false, dish: "", at: "", by: "engine" }));

describe("695: 30 photos with their copies fit one sample", () => {
  it("90 files at the editor's budgets pass; the 91st file, or bytes past 30 MB, are refused; a replacement counts once", () => {
    expect([PHOTOS_MAX, PHOTOS_BYTES_MAX]).toEqual([90, 30 * 1024 * 1024]);
    const files = Array.from({ length: 30 }, (_, i) => three(i + 1)).flat();
    for (let n = 0; n < files.length; n++) expect(uploadProblem(files[n][0], files[n][1], kept(files.slice(0, n))), files[n][0]).toBe("");
    const all = kept(files);
    expect(all.reduce((n, p) => n + p.bytes, 0)).toBe(30 * 680 * KB); // about 20 MB
    expect(uploadProblem("p31.webp", webp(150 * KB), all)).toBe("this sample keeps 90 photo files: delete one first");
    expect(uploadProblem("p1-2x.webp", webp(350 * KB), all), "the same name replaces").toBe("");
    // the bytes: 29 MB kept, a 2 MB file does not fit, a 900 KB one does
    const big = kept(Array.from({ length: 29 }, (_, i) => [`b${i}.webp`, webp(1024 * KB)] as [string, Uint8Array]));
    expect(uploadProblem("x.webp", webp(2048 * KB), big)).toMatch(/^this sample keeps 30 MB of photos \(29\.0 MB now, this one 2048 KB\)/);
    expect(uploadProblem("x.webp", webp(900 * KB), big)).toBe("");
    expect(uploadProblem("b0.webp", webp(2048 * KB), big), "replacing a 1 MB file with 2 MB fits").toBe("");
  });

  it("a sample takes the 90 files through the upload, then refuses the next with a 409", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const r = await writeLead(db, tenant.id, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, OLU, { create: true });
    if (!r.ok) throw new Error(r.message);
    const page = `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1><p>v1</p>${sampleFooter("Gamma Grill", "")}</body></html>`;
    const s = await saveDraft(db, tenant.id, r.lead.id, "eat", undefined, "Site Builder", async () => "", { html: page });
    const store = { put: async () => {} };
    let photos: SamplePhoto[] = [];
    for (const [name, b] of Array.from({ length: 30 }, (_, i) => three(i + 1)).flat()) photos = await putSamplePhoto(db, tenant.id, s.id, name, b, { guest: false, dish: "", by: "site helper" }, store);
    expect(photos).toHaveLength(90);
    await expect(putSamplePhoto(db, tenant.id, s.id, "p31.webp", webp(150 * KB), { guest: false, dish: "", by: "site helper" }, store)).rejects.toMatchObject({ status: 409 });
  });
});
