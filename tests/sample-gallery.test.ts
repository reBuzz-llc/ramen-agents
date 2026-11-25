// The aim is more than 20 photos on each sample's gallery: the card says how many of the sample's
// uploaded photos its gallery page uses, as a target line -- never a check, a warning or a block.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/db";
import { writeLead, type Actor } from "@/lib/leads";
import { galleryLine } from "@/lib/sample-labels";
import { putSamplePhoto, sampleCards, saveDraft, sampleFooter, type SampleCard } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);
const NOMAP = async () => "";
const page = (body: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1>${body}${sampleFooter("Gamma Grill", "")}</body></html>`;

describe("691: the gallery target line", () => {
  it("the words; nothing for a sample with no gallery to count", () => {
    expect(galleryLine(3)).toBe("Gallery: aim for more than 20 photos (3 so far)");
    expect(galleryLine(0)).toBe("Gallery: aim for more than 20 photos (0 so far)");
    expect(galleryLine(null)).toBeNull();
  });

  it("counts the uploaded photos the gallery page uses, each once; the main page's and a template's are not counted", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const mk = async (business: string) => {
      const r = await writeLead(db, tenant.id, {}, { business, industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, OLU, { create: true });
      if (!r.ok) throw new Error(r.message);
      return r.lead.id;
    };
    const t = tenant.id;
    const lead = await mk("Gamma Grill");
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    const store = { put: async () => {} };
    for (const n of ["a.webp", "b.webp", "c.webp", "main.webp"]) await putSamplePhoto(db, t, s.id, n, WEBP, { guest: false, dish: "", by: "engine" }, store);
    const gallery = page('<img src="../photos/a.webp"><img src="../photos/b.webp"><img src="../photos/a.webp"><img src="../photos/c.webp"><a href="../">Home</a>');
    await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page('<img src="photos/main.webp"><a href="gallery/">Photos</a>'), pages: [{ path: "gallery/index.html", html: gallery }] });
    await saveDraft(db, t, await mk("Delta Deli"), "eat", { headline: "Fresh deli sandwiches", about: "A neighbourhood deli with sandwiches and coffee every day.", cta: "Message us" }, "Site Builder", NOMAP);
    const { cards } = await sampleCards(db, t);
    expect(cards.find((c) => c.business === "Gamma Grill")?.galleryPhotos).toBe(3);
    expect(cards.find((c) => c.business === "Delta Deli")?.galleryPhotos).toBeNull();
  });

  it("the card shows the line in plain muted words, not as a warning", async () => {
    const { default: SampleDetail } = await import("@/app/samples/sample-cards");
    const card = {
      id: "11111111-2222-4333-8444-555555555557", leadId: "l", business: "Ssam Tong BBQ", area: "Flushing, NY", trade: "Restaurant", template: "eat", status: "draft", version: 20, draftedAt: "2026-11-20T16:42:00Z",
      draftedBy: "Site Builder", reviewedBy: "", url: "", hold: false, frozen: false, note: "", leadHref: "/leads/l", kind: "page", changes: "", designReason: "", sources: [], open: "/samples/x/preview",
      pages: [{ name: "gallery", open: "/samples/x/preview?page=gallery" }], guestPhotos: [], approvedVersion: null, requests: [], galleryPhotos: 12,
    } as SampleCard;
    const html = renderToStaticMarkup(createElement(SampleDetail, { c: card, isOwner: true, backHref: "/samples", publishPolledAt: "" }));
    expect(html).toMatch(/<p data-gallery="true" class="mb-2 text-sm text-muted">Gallery: aim for more than 20 photos \(12 so far\)<\/p>/);
  });
});
