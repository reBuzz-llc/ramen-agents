// The Samples page: every sample as a card, newest first, by status; the area without the street or
// a phone; "Open site" in a new tab, to the signed-in preview of the stored page or the live address; the bar's link and
// badge for everyone on the team.
import { readFileSync } from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { currentNav, NAV, REVIEW_NAV } from "@/app/nav-links";
import { memoryDb } from "@/lib/db";
import { samples } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { can } from "@/lib/roles";
import { cardOf, draftCount, reportPublish, reviewSample, sampleCards, saveDraft } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";

const src = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const COPY = { headline: "Fresh tacos, made to order", about: "A neighbourhood taqueria with tacos, burritos and aguas frescas, every day of the week.", cta: "Message us on WhatsApp" };
const NOMAP = async () => "";

describe("cardOf", () => {
  const s = { id: "s1", leadId: "l1", template: "restaurant", status: "draft", version: 2, updatedAt: new Date("2026-11-12T10:00:00Z"), draftedBy: "Site Builder",
    reviewedBy: "", url: "", hold: false, frozenAt: null, note: "", changesNote: "" };
  const lead = { business: "Taco Loco | 타코 | Mexican", industry: "Mexican restaurant", city: "Astoria", state: "NY", address: "31-15 Steinway St", phone: "(718) 555-0100" };
  it("names the business, the city and state only, the trade and the family; a draft opens at its preview", () => {
    const c = cardOf(s, lead);
    expect(c).toMatchObject({ business: "Taco Loco", area: "Astoria, NY", trade: "Mexican restaurant", template: "eat", version: 2, open: "/samples/s1/preview", leadHref: "/leads?lead=l1" });
    expect(JSON.stringify(c)).not.toMatch(/Steinway|555-0100/);
    // no city column: no area, never the location's first part (the street)
    expect(cardOf(s, { business: "X", location: "31-15 Steinway St, Astoria, NY" }).area).toBe("");
  });
  it("a live page opens at its https address; anything else stays on the preview", () => {
    expect(cardOf({ ...s, status: "live", url: "https://x.pages.dev/taco-loco/" }, lead).open).toBe("https://x.pages.dev/taco-loco/");
    expect(cardOf({ ...s, status: "live", url: "javascript:alert(1)" }, lead).open).toBe("/samples/s1/preview");
    expect(cardOf({ ...s, status: "taken_down", url: "https://x.pages.dev/taco-loco/" }, lead).open).toBe("/samples/s1/preview");
  });
  it("shows the person's note when sent back or on a frozen page", () => {
    expect(cardOf({ ...s, status: "changes_requested", note: "Add catering" }, lead).note).toBe("Add catering");
    expect(cardOf({ ...s, status: "draft", note: "old" }, lead).note).toBe("");
    expect(cardOf({ ...s, status: "live", changesNote: "New hours" }, lead).note).toBe("New hours");
  });
});

describe("sampleCards past its limit (876)", () => {
  it("keeps what still waits on someone, counts every sample, and says how many there are", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const make = async (business: string) => {
      const r = await writeLead(db, tenant.id, {}, { business, industry: "Clothing store", city: "Newark", state: "NJ", whatsapp: "https://wa.me/17185550100" }, OLU, { create: true });
      if (!r.ok) throw new Error(r.message);
      return saveDraft(db, tenant.id, r.lead.id, undefined, COPY, "Site Builder", NOMAP);
    };
    const waiting = await make("Harold Vintage");
    const finished = await make("Main St Finest");
    await db.update(samples).set({ status: "taken_down", updatedAt: new Date("2026-11-20T10:00:00Z") }).where(eq(samples.id, finished.id));
    await db.update(samples).set({ updatedAt: new Date("2026-11-01T10:00:00Z") }).where(eq(samples.id, waiting.id));
    const cut = await sampleCards(db, tenant.id, undefined, 1);
    expect(cut.cards.map((c) => c.id)).toEqual([waiting.id]);
    expect(cut.total).toBe(2);
    expect(cut.counts).toMatchObject({ draft: 1, taken_down: 1 });
    const all = await sampleCards(db, tenant.id);
    expect(all.cards.map((c) => c.id)).toEqual([finished.id, waiting.id]);
    expect(all.total).toBe(2);
    const one = await sampleCards(db, tenant.id, "taken_down", 1);
    expect(one.cards.map((c) => c.id)).toEqual([finished.id]);
    expect(one.total).toBe(1);
  });
});

describe("sampleCards and the badge", () => {
  it("lists every sample newest first with the count of each status, filters one, and counts the drafts", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const make = async (business: string, city: string) => {
      const r = await writeLead(db, tenant.id, {}, { business, industry: "Clothing store", city, state: "NJ", whatsapp: "https://wa.me/17185550100" }, OLU, { create: true });
      if (!r.ok) throw new Error(r.message);
      return saveDraft(db, tenant.id, r.lead.id, undefined, COPY, "Site Builder", NOMAP);
    };
    const a = await make("Harold Vintage", "Hoboken");
    const b = await make("Main St Finest", "Newark");
    const c = await make("Chic Boutique", "Paterson");
    expect(await draftCount(db, tenant.id)).toBe(3);
    await reviewSample(db, tenant.id, a.id, "approve", { name: "Olu" });
    const liveUrl = `https://acme.pages.dev/${a.slug}/`;
    await reportPublish(db, tenant.id, a.id, "published", liveUrl);
    await reviewSample(db, tenant.id, b.id, "changes", { name: "Olu" }, "Warmer photos");
    const all = await sampleCards(db, tenant.id);
    expect(all.cards.map((x) => x.business)).toEqual(["Main St Finest", "Harold Vintage", "Chic Boutique"]);
    expect(all.counts).toEqual({ draft: 1, changes_requested: 1, approved: 0, live: 1, taken_down: 0, rejected: 0 });
    expect(all.cards.find((x) => x.id === a.id)?.open).toBe(liveUrl);
    expect((await sampleCards(db, tenant.id, "draft")).cards.map((x) => x.id)).toEqual([c.id]);
    expect(await draftCount(db, tenant.id)).toBe(1);
    const other = await createTenant(db, "Other", "other", { email: "x@other.example", name: "X" });
    expect((await sampleCards(db, other.tenant.id)).cards).toEqual([]);
  });
});

describe("the page, the preview and the bar", () => {
  it("Samples sits after Leads for everyone on the team, and marks itself", () => {
    expect(REVIEW_NAV).toEqual({ href: "/samples", label: "Sample" });
    expect(NAV.map((n) => n.href)).not.toContain("/samples");
    expect(currentNav("/samples")).toBe("/samples");
    expect((["owner", "manager", "member"] as const).map((r) => can(r, "samples.review"))).toEqual([true, true, true]);
    expect(src("app/layout.tsx")).toMatch(/can\(who\.role, "samples\.review"\) \? got!\.data : null/);
    expect(src("app/samples/page.tsx")).toMatch(/can\(who\.role, "samples\.review"\)/);
  });
  it("a photo's Accept accepts at once; only the picture opens the full-size view", () => {
    const s = src("app/samples/sample-cards.tsx");
    expect(s).toMatch(/onClick=\{\(\) => !accepted && onAccept\(p\)\}[^>]*data-photo-accept/);
    expect(s).toMatch(/onClick=\{\(\) => setViewing\(p\.base\)\}[^>]*data-photo-open/);
    expect(s).not.toMatch(/Accept opens the photo at full size/);
  });
  it("what a photo shows has an Other choice with a box for a typed name", () => {
    const s = src("app/samples/sample-cards.tsx");
    expect(s).toMatch(/<option value=\{OTHER_DISH\}>Other: type a name…<\/option>/);
    expect(s).toMatch(/maxLength=\{DISH_MAX\}[\s\S]*data-photo-dish-text/);
  });
  it("Open site is a new tab without the opener; the preview is signed in, noindex, the stored html under a CSP", () => {
    expect(src("app/samples/sample-cards.tsx")).toMatch(/href=\{c\.open\} target="_blank" rel="noopener"/);
    const r = src("app/samples/[id]/preview/route.ts");
    expect(r).toMatch(/await me\(\)/);
    expect(r).toMatch(/withNext\("\/sign-in", here\)/);
    expect(r).toMatch(/sampleDoc\(/);
    expect(r).toMatch(/"x-robots-tag": "noindex, nofollow"/);
    expect(r).toMatch(/pageCsp\(html, doc.kind\)/); // the page served (the main one or ?page=), under its own CSP
    // the Sample box on the lead row is unchanged
    expect(src("app/leads/sample-box.tsx")).toMatch(/export function SampleBox/);
  });
});
