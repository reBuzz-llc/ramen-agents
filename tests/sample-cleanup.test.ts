// The samples' file clean-up. (b) older versions' Approve copies
// 14 days after a newer approval, the approved one and the one before it kept; (c) a rejected or taken-down sample's files
// after 30 days; (d) photos no version used for 30 days. Never a file the current or the approved version uses. A dry run
// lists and changes nothing; a sweep removes, updates the rows, and answers counts and megabytes only.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { sampleRequests, sampleVersions, samples } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { runCleanup } from "@/lib/sample-cleanup";
import { storageFull, storageLine } from "@/lib/sample-labels";
import { reviewOf, sampleFooter, type SampleCard } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";

const DAY = 86_400_000;
const NOW = new Date("2026-12-31T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);
const page = (body: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>G</h1>${body}${sampleFooter("G", "")}</body></html>`;
const copy = (id: string, v: number, at?: Date) => ({ src: "https://x", path: "assets/1.jpg", key: `samples/${id}/v${v}/1.jpg`, type: "image/jpeg", bytes: 200 * 1024, ...(at ? { at: at.toISOString() } : {}) });
const photo = (id: string, name: string, at: Date) => ({ name, key: `samples/${id}/photos/${name}`, type: "image/webp", bytes: 100 * 1024, guest: false, dish: "", at: at.toISOString(), by: "site helper" });

async function setup() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const sample = async (business: string, row: Partial<typeof samples.$inferInsert>) => {
    const r = await writeLead(db, tenant.id, {}, { business, industry: "Restaurant", location: "Astoria, NY" }, OLU, { create: true });
    if (!r.ok) throw new Error(r.message);
    const [s] = await db.insert(samples).values({ tenantId: tenant.id, leadId: r.lead.id, slug: business.toLowerCase().replace(/\W+/g, "-"), template: "eat", kind: "page", html: page("<p>x</p>"), ...row }).returning();
    return s;
  };
  const version = (sampleId: string, version: number, row: Partial<typeof sampleVersions.$inferInsert>) =>
    db.insert(sampleVersions).values({ tenantId: tenant.id, sampleId, version, template: "eat", html: page("<p>old</p>"), madeAt: ago(60), ...row });
  return { db, t: tenant.id, sample, version };
}
const keysOf = (r: { items?: { key: string }[] }) => (r.items ?? []).map((x) => x.key).sort();

describe("clean-up (b): older versions' Approve copies", () => {
  it("go 14 days after a newer version was approved; the approved version's and the one before it stay", async () => {
    const { db, t, sample, version } = await setup();
    const s = await sample("Gamma Grill", { status: "live", version: 4, approvedVersion: 4, url: "https://x.pages.dev/g/" });
    await db.update(samples).set({ assets: [copy(s.id, 4, ago(5))] }).where(eq(samples.id, s.id));
    await version(s.id, 1, { assets: [copy(s.id, 1, ago(60))] });
    await version(s.id, 2, { assets: [copy(s.id, 2, ago(20))] });
    await version(s.id, 3, { assets: [copy(s.id, 3, ago(10))] });
    // v3 is the approved one before v4 (kept); v2's newer approval (v3) was 10 days ago (kept); v1's (v2) 20 days ago: goes
    expect(keysOf(await runCleanup(db, t, { now: NOW }))).toEqual([`samples/${s.id}/v1/1.jpg`]);
    expect(keysOf(await runCleanup(db, t, { now: new Date(NOW.getTime() - 7 * DAY) }))).toEqual([]);
  });
});

describe("clean-up (c): a rejected or taken-down sample's files", () => {
  it("go 30 days after it came down and is off the web: photos, every copy, the requests' pictures; the text stays", async () => {
    const { db, t, sample, version } = await setup();
    const s = await sample("Old Deli", { status: "taken_down", version: 2, url: "", updatedAt: ago(31) });
    await db.update(samples).set({ photos: [photo(s.id, "a.webp", ago(90))], assets: [copy(s.id, 2, ago(60))] }).where(eq(samples.id, s.id));
    await version(s.id, 1, { assets: [copy(s.id, 1, ago(80))] });
    await db.insert(sampleRequests).values({ tenantId: t, sampleId: s.id, text: "Bigger hours", pictures: [{ n: 1, key: `samples/${s.id}/requests/r/1.png`, type: "image/png", bytes: 50 * 1024 }], byName: "Olu", at: ago(70), madeOnVersion: 1 });
    const young = await sample("Young Deli", { status: "rejected", url: "", updatedAt: ago(29) });
    await db.update(samples).set({ photos: [photo(young.id, "b.webp", ago(90))] }).where(eq(samples.id, young.id));
    const stillUp = await sample("Still Up", { status: "taken_down", url: "https://x.pages.dev/u/", updatedAt: ago(40) });
    await db.update(samples).set({ photos: [photo(stillUp.id, "c.webp", ago(90))] }).where(eq(samples.id, stillUp.id));
    const dry = await runCleanup(db, t, { now: NOW });
    expect(keysOf(dry)).toEqual([`samples/${s.id}/photos/a.webp`, `samples/${s.id}/requests/r/1.png`, `samples/${s.id}/v1/1.jpg`, `samples/${s.id}/v2/1.jpg`].sort());
    expect(dry.byRule["dead-sample"]).toEqual({ files: 4, mb: 0.5 });
    // a sweep removes them and clears the lists; the rows and the request's text stay
    const removed: string[] = [];
    const swept = await runCleanup(db, t, { now: NOW, dry: false, remove: async (k) => void removed.push(k) });
    expect(swept).toMatchObject({ dry: false, files: 4, samples: 1 });
    expect(swept.items).toBeUndefined();
    expect(removed.sort()).toEqual(keysOf(dry));
    const [row] = await db.select().from(samples).where(eq(samples.id, s.id));
    expect(row).toMatchObject({ photos: [], assets: [], status: "taken_down" });
    const [v1] = await db.select().from(sampleVersions).where(eq(sampleVersions.sampleId, s.id));
    expect(v1.assets).toEqual([]);
    const [q] = await db.select().from(sampleRequests).where(eq(sampleRequests.sampleId, s.id));
    expect(q).toMatchObject({ text: "Bigger hours", pictures: [] });
    // a second sweep has nothing left
    expect((await runCleanup(db, t, { now: NOW, dry: false, remove: async () => {} })).files).toBe(0);
  });
});

describe("clean-up (d) and the guard: photos", () => {
  it("a photo no version used for 30 days goes; one the current or the approved version shows never does", async () => {
    const { db, t, sample, version } = await setup();
    const s = await sample("Gamma Grill", { status: "draft", version: 3, approvedVersion: 2, url: "https://x.pages.dev/g/", html: page('<img src="photos/current.webp" alt="x">') });
    await db.update(samples).set({ photos: [photo(s.id, "current.webp", ago(90)), photo(s.id, "approved.webp", ago(90)), photo(s.id, "recent.webp", ago(90)), photo(s.id, "fresh.webp", ago(3)), photo(s.id, "stale.webp", ago(90))] }).where(eq(samples.id, s.id));
    // v2 is the approved version on the web, made long ago: what it shows stays
    await version(s.id, 2, { html: page('<img src="photos/approved.webp" alt="x">'), madeAt: ago(80) });
    // v1 used "recent" 10 days ago
    await version(s.id, 1, { html: page('<img src="photos/recent.webp" alt="x">'), madeAt: ago(10) });
    expect(keysOf(await runCleanup(db, t, { now: NOW }))).toEqual([`samples/${s.id}/photos/stale.webp`]);
    // the dry run changed nothing
    const [row] = await db.select().from(samples).where(eq(samples.id, s.id));
    expect(row.photos).toHaveLength(5);
  });
});

describe("clean-up: what the owner sees", () => {
  const card = (over: Partial<SampleCard> = {}): SampleCard => ({
    id: "s", leadId: "l", business: "G", area: "", trade: "", template: "eat", status: "taken_down", version: 2, draftedAt: new Date(Date.now() - 25 * DAY).toISOString(), draftedBy: "",
    reviewedBy: "", url: "", hold: false, frozen: false, note: "", leadHref: "", kind: "page", changes: "", designReason: "", sources: [], open: "", pages: [], guestPhotos: [], approvedVersion: null, requests: [], ...over,
  });
  it("in the 7 days before, the list says when a dead sample's files go; before that, nothing", () => {
    expect(reviewOf(card()).why).toMatch(/^Taken down · its photos and pictures are removed on [A-Z][a-z]{2} \d{1,2}; the text stays$/);
    expect(reviewOf(card({ draftedAt: new Date(Date.now() - 10 * DAY).toISOString() })).why).toBe("Taken down");
    expect(reviewOf(card({ status: "rejected", draftedAt: new Date(Date.now() - 31 * DAY).toISOString() })).why).toBe("Rejected · its photos and pictures are removed on the next clean-up; the text stays");
  });
  it("the storage line warns at 80%", () => {
    const G = 1024 * 1024 * 1024;
    expect(storageFull({ totalBytes: 0.79 * G })).toBe(false);
    expect(storageFull({ totalBytes: 0.8 * G })).toBe(true);
    expect(storageLine({ totalBytes: 0.85 * G, sampleBytes: 0.5 * G, samples: 40 })).toMatch(/^Nearly full: Photo storage: 870 MB of 1 GB used \(85%\)/);
  });
});
