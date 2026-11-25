// A sample's extra pages (the gallery page): each checked like the main page, at most 3, kept with its
// version, previewed with ?page=, published at <slug>/<name>/ with its pictures from the slug's assets/.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { samples } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { cleanPages, pageName, previewLinks, previewPage } from "@/lib/sample-pages";
import { handoverFiles, publishQueue, reviewSample, sampleCards, sampleDoc, sampleFooter, saveDraft } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";

const FOOT = sampleFooter("Taco Loco", "");
const page = (body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Taco Loco</title></head><body>${body}${FOOT}</body></html>`;
const PHOTO = "https://lh3.googleusercontent.com/p/abc=w800";
const PHOTO2 = "https://lh3.googleusercontent.com/p/def=w800";
const LEAD = { address: "31-15 Steinway St, Astoria, NY 11103", phone: "(718) 555-0100", contactPerson: "Maria Lopez" };
const NOMAP = async () => "";

describe("the extra pages' rules", () => {
  it("a path is <name>/index.html; at most 3; each page passes the main page's checks, named in the refusal", () => {
    expect(pageName("gallery/index.html")).toBe("gallery");
    for (const bad of ["gallery.html", "assets/index.html", "Gallery/index.html", "a/b/index.html", "../x/index.html"]) expect(pageName(bad)).toBeNull();
    expect(cleanPages(undefined, LEAD)).toEqual({ ok: true, pages: [] });
    expect(cleanPages([{ path: "gallery/index.html", html: page("<h1>Photos</h1>") }], LEAD)).toMatchObject({ ok: true, pages: [{ path: "gallery/index.html" }] });
    const four = Array.from({ length: 4 }, (_, i) => ({ path: `p${i}/index.html`, html: page("x") }));
    expect(cleanPages(four, LEAD)).toMatchObject({ ok: false, error: /at most 3/ });
    expect(cleanPages([{ path: "gallery/index.html", html: page("<p>call (718) 555-0100</p>") }], LEAD)).toMatchObject({ ok: false, error: /^gallery: the page shows the phone number/ });
    expect(cleanPages([{ path: "a/index.html", html: page("x") }, { path: "a/index.html", html: page("y") }], LEAD)).toMatchObject({ ok: false, error: /two pages/ });
    expect(cleanPages([{ path: "gallery/index.html", html: "<p>no footer</p>" }], LEAD)).toMatchObject({ ok: false });
  });

  it("the preview keeps links between the pages inside it", () => {
    const main = `<a href="gallery/">Photos</a><a href="./gallery/index.html">x</a><a href="menu/">no such page</a><a href="https://wa.me/1">wa</a>`;
    expect(previewLinks(main, ["gallery"], null)).toBe(`<a href="?page=gallery">Photos</a><a href="?page=gallery">x</a><a href="menu/">no such page</a><a href="https://wa.me/1">wa</a>`);
    expect(previewLinks(`<a href="../">Home</a><a href="../index.html">h</a>`, ["gallery"], "gallery", 3)).toBe(`<a href="?v=3">Home</a><a href="?v=3">h</a>`);
    const doc = { html: page(`<a href="gallery/">Photos</a>`), pages: [{ path: "gallery/index.html", html: page("<h1>Photos</h1>") }] };
    expect(previewPage(doc, "gallery")).toContain("<h1>Photos</h1>");
    expect(previewPage(doc, "nope")).toBeNull();
    expect(previewPage(doc, null)).toContain('href="?page=gallery"');
  });
});

describe("a sample with a gallery page on Peek", () => {
  it("drafted, kept with its version, previewed, on the card, approved with its pictures, published at <slug>/gallery/, in the bundle", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const r = await writeLead(db, tenant.id, {}, { business: "Taco Loco", industry: "Mexican restaurant", location: "31-15 Steinway St, Astoria, NY 11103",
      whatsapp: "https://wa.me/17185550100", phone: "(718) 555-0100", contact_person: "Maria Lopez", package: "Starter Website" }, OLU, { create: true });
    if (!r.ok) throw new Error(r.message);
    const t = tenant.id, lead = String(r.lead.id);
    const gallery = { path: "gallery/index.html", html: page(`<h1>Photos</h1><img src="${PHOTO2}"><a href="../">Home</a>`) };
    await expect(saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("x"), pages: [{ path: "gallery/index.html", html: page("<p>Maria Lopez</p>") }] })).rejects.toThrow(/gallery: the page names a person/);
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page(`<img src="${PHOTO}"><a href="gallery/">Photos</a>`), pages: [gallery] });
    expect(s.pageNames).toEqual(["gallery"]);
    expect((await sampleDoc(db, t, s.id))?.pages.map((p) => p.path)).toEqual(["gallery/index.html"]);
    const { cards } = await sampleCards(db, t);
    expect(cards[0].pages).toEqual([{ name: "gallery", open: `/samples/${s.id}/preview?page=gallery` }]);
    // a better draft keeps the first, gallery and all, as version 1
    const s2 = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page(`<img src="${PHOTO}"><a href="gallery/">Photos</a><p>v2</p>`), pages: [gallery] });
    expect((await sampleDoc(db, t, s2.id, 1))?.pages.length).toBe(1);
    // Approve counts the main page's and the gallery's outside pictures and refuses them
    await expect(reviewSample(db, t, s2.id, "approve", { name: "Olu" }, "", { put: async () => {} })).rejects.toThrow(/^2 pictures on this page were not uploaded through Peek/);
    // a page approved before the photo checks publishes both pages from the one assets/ folder
    await db.update(samples).set({ status: "approved", approvedVersion: s2.version, reviewedBy: "Olu", assets: [
      { src: PHOTO, path: "assets/1.jpg", key: `samples/${s2.id}/v2/1.jpg`, type: "image/jpeg" },
      { src: PHOTO2, path: "assets/2.jpg", key: `samples/${s2.id}/v2/2.jpg`, type: "image/jpeg" },
    ] }).where(eq(samples.id, s2.id));
    const [item] = await publishQueue(db, t, new Date(), async (key) => `https://bucket.example/${key}`);
    expect(item.pages).toHaveLength(1);
    expect(item.pages[0].path).toBe("gallery/index.html");
    expect(item.pages[0].html).toContain('src="../assets/2.jpg"');
    expect(item.pages[0].html).not.toContain(PHOTO2);
    expect(item.html).toContain('src="assets/1.jpg"');
    // the handover bundle has the gallery in its folder
    const files = handoverFiles({ slug: "taco-loco", version: 2, template: "eat", copy: {}, html: page("x"), pages: [gallery] }, { business: "Taco Loco", listingEvidence: "" } as never, "$990");
    expect(files.map(([n]) => n)).toContain("gallery/index.html");
  });
});
