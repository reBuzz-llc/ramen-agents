// The Site Builder's production line on Peek: five families, copy v3 with SB05
// and SB06, the angle from the pain point, facts-only re-renders on the lead write with each version kept, the queue in
// its order, freeze at a reply, hold, auto-approve and the Handover bundle.
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { memoryDb } from "@/lib/db";
import { accept } from "@/lib/claims";
import { sampleVersions, tenants } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { angleOf, checkCopy, familyOf, handoverOf, pickFamily, publishQueue, renderSample, reviewSample, sampleHtml, sampleQueue, sampleVersionsOf, saveDraft } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";
import { crc32, zipStore } from "@/lib/zip";
import FAMILY_CASES from "./fixtures/sample_families.json";
import { HUMAN_REQUEST_ONLY } from "@/lib/samples";

const V3 = { headline: "Fresh tacos, made to order", about: "A neighbourhood taqueria with tacos, burritos and aguas frescas, open every day.", cta: "Message us on WhatsApp" };
const NOMAP = async () => "";
const ROW = { business: "Taco Loco", industry: "Mexican restaurant", listingEvidence: "Google listing: 4.6★ (212 reviews), Mexican restaurant, open 7 days", painPoint: "Found only through the Google listing\nThey can try: a page\nWe propose: Starter Website" };

describe("families and copy v3", () => {
  it("five families; the older template names read as theirs", () => {
    expect([pickFamily("Dentist"), pickFamily("Gym"), pickFamily("Tax lawyer"), pickFamily("Bakery"), pickFamily("Bridal boutique"), pickFamily("Museum")])
      .toEqual(["care", "care", "services", "eat", "shop", "plain"]);
    expect(["restaurant", "shop", "trades", "salon", "general", "eat", "nope", 3].map(familyOf)).toEqual(["eat", "shop", "services", "care", "plain", "eat", null, null]);
  });

  it("the engine's fixture: every trade picks the same family on both sides", () => {
    const got = (FAMILY_CASES.cases as string[][]).map(([trade, kind]) => [trade, kind, pickFamily(trade, kind)]);
    expect(got).toEqual(FAMILY_CASES.cases);
  });

  it("three texts, the older shape still taken; SB05 only what the row backs; SB06 never our places", () => {
    expect(checkCopy(V3, ROW)).toEqual({ ok: true, copy: V3 });
    expect(checkCopy({ headline: "x", about: "", cta: "y" }, ROW)).toMatchObject({ ok: false, error: expect.stringMatching(/headline, an about and a cta/) });
    expect(checkCopy({ ...V3, about: "y".repeat(241) }, ROW)).toMatchObject({ ok: false, error: expect.stringMatching(/about is 241 characters; at most 240/) });
    // the row says 212 reviews and 7 days: those numbers may appear; a year it does not say may not
    expect(checkCopy({ ...V3, about: "Loved in 212 reviews, open 7 days a week for tacos." }, ROW)).toMatchObject({ ok: true });
    expect(checkCopy({ ...V3, about: "Serving tacos since 1998 to the whole street." }, ROW)).toMatchObject({ ok: false, error: expect.stringMatching(/"1998".*SB05/) });
    expect(checkCopy({ ...V3, about: "A family-owned taqueria with tacos every day." }, ROW)).toMatchObject({ ok: false, error: expect.stringMatching(/family-owned.*SB05/) });
    expect(checkCopy({ ...V3, about: "A family-owned taqueria with tacos every day." }, { ...ROW, listingEvidence: `${ROW.listingEvidence}, family-owned` })).toMatchObject({ ok: true });
    expect(checkCopy({ ...V3, about: "Tacos made with care, like back in Placeville." }, ROW, { places: ["Placeville"] }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/place the team works from.*SB06/) });
    const old = { headline: "Fresh tacos", intro: "Tacos every day of the week.", sections: [{ title: "Menu", body: "Tacos." }, { title: "Visit", body: "Walk in." }], cta: "Message us" };
    expect(checkCopy(old, ROW)).toMatchObject({ ok: true, copy: { intro: "Tacos every day of the week." } });
  });

  it("the pain point's first line picks the lead section; the area and WhatsApp, never the street or a phone (rule r1, 476b)", () => {
    expect([angleOf(ROW.painPoint), angleOf("Pain point: no online menu"), angleOf("No photos of the shop anywhere"), angleOf("Slow to answer emails"), angleOf(null)])
      .toEqual(["contact", "menu", "photos", "story", "story"]);
    const lead = { ...ROW, city: "Astoria", state: "NY", address: "31-15 Steinway St, Astoria", phone: "(718) 555-0100", whatsapp: "https://wa.me/17185550100" };
    const html = renderSample(lead, "eat", V3);
    expect(html).toContain('data-angle="contact"');
    expect(html.indexOf('<ul class="facts">')).toBeLessThan(html.indexOf("Fresh tacos, made to order"));   // contact first
    expect(html).toContain("<li>Serving Astoria, NY</li>");
    for (const leak of ["Steinway", "tel:", "555-0100"]) expect(html).not.toContain(leak);
    expect(html).toContain('<section class="menu">');                                                    // eat has a menu spot
    const story = renderSample({ ...lead, painPoint: "Slow to answer" }, "services", V3);
    expect(story.indexOf("Fresh tacos, made to order")).toBeLessThan(story.indexOf('<ul class="facts">'));
    expect(story).not.toContain("tel:");
    expect(story).not.toContain('class="menu"');
  });
});

describe("the line on the database", () => {
  async function setup() {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const mk = async (business: string, extra: Record<string, unknown> = {}) => {
      const r = await writeLead(db, tenant.id, {}, { business, industry: "Mexican restaurant", package: "Starter Website", listing_evidence: ROW.listingEvidence,
        pain_point: ROW.painPoint, whatsapp: "https://wa.me/17185550100", ...extra }, OLU, { create: true });
      if (!r.ok) throw new Error(r.message);
      return String(r.lead.id);
    };
    return { db, tenant, owner, OLU, mk };
  }

  it("the queue in order, a facts change re-rendered at once with the old copy kept as a version, a copy change listed as recopy", async () => {
    const { db, tenant, owner, OLU, mk } = await setup();
    const backlog = await mk("Old Taqueria");
    const packed = await mk("Packed Tacos");
    const replied = await mk("Replied Tacos");
    await writeLead(db, tenant.id, { id: replied }, { result: "Replied" }, OLU);
    await accept(db, tenant.id, packed, owner.id);
    await mk("Has Site", { website: "https://hassite.example" });
    const q = await sampleQueue(db, tenant.id, 10, NOMAP);
    expect(q.map((i) => [i.reason, i.facts.business])).toEqual([["pack", "Packed Tacos"], ["replied", "Replied Tacos"], ["backlog", "Old Taqueria"]]);
    expect(q[0]).toMatchObject({ family: "eat", sampleId: null, facts: { rating: "4.6", reviews: 212, open: "Open 7 days", kind: "Mexican restaurant" } });
    expect((await sampleQueue(db, tenant.id, 1, NOMAP)).map((i) => i.reason)).toEqual(["pack"]);

    const s1 = await saveDraft(db, tenant.id, backlog, "eat", V3, "Site Builder", NOMAP);
    expect(s1).toMatchObject({ version: 1, template: "eat", status: "draft" });
    expect(s1.factsHash).toMatch(/^[0-9a-f]{16}$/);
    // a facts change (the listing's opening days): the page re-rendered on the write, version 2, the copy the same, version 1 kept
    await writeLead(db, tenant.id, { id: backlog }, { listing_evidence: "Google listing: 4.6★ (212 reviews), Mexican restaurant, open 6 days (closed Monday)" }, OLU);
    const v = await sampleVersionsOf(db, tenant.id, s1.id);
    expect(v.map((x) => [x.version, x.current])).toEqual([[2, true], [1, false]]);
    expect(await sampleHtml(db, tenant.id, s1.id)).toContain("Open 6 days (closed Monday)");
    expect(await sampleHtml(db, tenant.id, s1.id, 1)).not.toContain("closed Monday");
    expect(await sampleHtml(db, tenant.id, s1.id)).toContain("Fresh tacos, made to order");
    expect((await sampleQueue(db, tenant.id, 10, NOMAP)).find((i) => i.leadId === backlog)).toBeUndefined();
    // a pain point change: listed as recopy, and the waiting draft may be replaced
    await writeLead(db, tenant.id, { id: backlog }, { pain_point: "No online menu\nThey can try: a menu\nWe propose: Starter Website" }, OLU);
    expect((await sampleQueue(db, tenant.id, 10, NOMAP)).find((i) => i.leadId === backlog)).toMatchObject({ reason: "recopy", sampleId: s1.id });
    const s3 = await saveDraft(db, tenant.id, backlog, "eat", { ...V3, headline: "See the menu" }, "Site Builder", NOMAP);
    expect(s3).toMatchObject({ version: 3, status: "draft" });
    expect(await sampleHtml(db, tenant.id, s1.id)).toContain('data-angle="menu"');
    await expect(saveDraft(db, tenant.id, backlog, "eat", V3, "Site Builder", NOMAP)).rejects.toThrow(/waiting for a person/);
  });

  it("a reply freezes it; a copy-only save names no request, so a frozen page stays as it is (829); hold keeps it off the web", async () => {
    const { db, tenant, OLU, mk } = await setup();
    const id = await mk("Luna Tacos");
    const s = await saveDraft(db, tenant.id, id, undefined, V3, "Site Builder", NOMAP);
    await reviewSample(db, tenant.id, s.id, "approve", { name: "Olu" });
    await writeLead(db, tenant.id, { id }, { result: "Meeting" }, OLU);
    const [frozen] = (await publishQueue(db, tenant.id)).filter((x) => x.id === s.id);
    expect(frozen).toMatchObject({ status: "approved", hold: false });
    // no automatic rebuild once frozen
    await writeLead(db, tenant.id, { id }, { listing_evidence: "Google listing: 4.6★ (212 reviews), Mexican restaurant, open 5 days" }, OLU);
    expect(await sampleHtml(db, tenant.id, s.id)).not.toContain("Open 5 days");
    const noted = await reviewSample(db, tenant.id, s.id, "changes", { name: "Olu" }, "Say they cater too");
    expect(noted).toMatchObject({ status: "approved", changesNote: "Say they cater too" });
    expect((await sampleQueue(db, tenant.id, 10, NOMAP))[0]).toMatchObject({ reason: "changes", note: "Say they cater too" });
    // only a page that names a person's request makes a new version; version 1 stays up
    await expect(saveDraft(db, tenant.id, id, undefined, { ...V3, about: "Tacos every day, and catering for the office too." }, "Site Builder", NOMAP)).rejects.toThrow(HUMAN_REQUEST_ONLY);
    const served = (await publishQueue(db, tenant.id)).find((x) => x.id === s.id);
    expect(served).toMatchObject({ status: "approved", version: 1 });
    expect(served?.html).not.toContain("catering");
    await reviewSample(db, tenant.id, s.id, "hold", { name: "Olu" });
    expect((await publishQueue(db, tenant.id)).find((x) => x.id === s.id)).toBeUndefined();   // not up; nothing on the web to bring down
    expect((await reviewSample(db, tenant.id, s.id, "release", { name: "Olu" })).hold).toBe(false);
    expect((await publishQueue(db, tenant.id)).find((x) => x.id === s.id)).toMatchObject({ hold: false, version: 1 });
  });

  it("829 (was 690): a helper's new version of an approved sample with no request is refused and the approved one stays up; a frozen one too", async () => {
    const { db, tenant, OLU, mk } = await setup();
    const id = await mk("Curio Pizza");
    const s = await saveDraft(db, tenant.id, id, undefined, V3, "Site Builder", NOMAP);
    await reviewSample(db, tenant.id, s.id, "approve", { name: "Olu" });
    await expect(saveDraft(db, tenant.id, id, undefined, { ...V3, about: "Pizza by the slice, open every day, call ahead for pies." }, "site helper", NOMAP)).rejects.toThrow(HUMAN_REQUEST_ONLY);
    const served = (await publishQueue(db, tenant.id)).find((x) => x.id === s.id);
    expect(served).toMatchObject({ status: "approved", version: 1 });
    expect(served?.html).not.toContain("call ahead");
    // a lead that answered (frozen) takes a new version only on a person's request
    const other = await mk("Frozen Slice");
    const f = await saveDraft(db, tenant.id, other, undefined, V3, "Site Builder", NOMAP);
    await reviewSample(db, tenant.id, f.id, "approve", { name: "Olu" });
    await writeLead(db, tenant.id, { id: other }, { result: "Meeting" }, OLU);
    await expect(saveDraft(db, tenant.id, other, undefined, V3, "site helper", NOMAP)).rejects.toThrow(/frozen\): a person's change request/);
  });

  it("auto-approve when the owner turns it on; our places refused on save", async () => {
    const { db, tenant, mk } = await setup();
    await db.update(tenants).set({ settings: { samplesAutoPublish: true, ownPlaces: ["Placeville"] } }).where(eq(tenants.id, tenant.id));
    const id = await mk("Auto Tacos");
    await expect(saveDraft(db, tenant.id, id, undefined, { ...V3, about: "Tacos the way they make them in Placeville, every day." }, "Site Builder", NOMAP)).rejects.toThrow(/SB06/);
    expect(await saveDraft(db, tenant.id, id, undefined, V3, "Site Builder", NOMAP)).toMatchObject({ status: "approved", reviewedBy: "Auto-approved (Settings)" });
  });

  it("the Handover bundle: the page, its pictures and facts.md with each field's source; a zip any tool opens", async () => {
    const { db, tenant, mk } = await setup();
    const id = await mk("Bundle Tacos", { address: "1 Main St", phone: "+1 718 555 0100" });
    const s = await saveDraft(db, tenant.id, id, undefined, V3, "Site Builder", async () => "data:image/png;base64,iVBORw0KGgo=");
    const b = await handoverOf(db, tenant.id, s.id);
    expect(b?.files.map(([n]) => n)).toEqual(["index.html", "assets/map.png", "assets/illustration.svg", "facts.md"]);
    const [, index] = b!.files[0];
    expect(String(index)).toContain('src="assets/map.png"');
    const md = String(b!.files[3][1]);
    expect(md).toContain("- **Address:** 1 Main St -- row: Address (not on the sample page: the area only)");
    expect(md).toContain("- **Opening days:** Open 7 days -- Google listing (row: Listing evidence)");
    expect(md).toContain("- **About:** " + V3.about + " -- Site Builder's text");
    expect(md).toContain("- **Footer price:** priced after a short call -- template, from the Rates' Starter Website line");
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926);
    const zip = zipStore(b!.files);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.readUInt16LE(zip.length - 12)).toBe(4);                // four entries in the end record
    expect((await db.select().from(sampleVersions)).length).toBe(0);  // a first draft keeps no older version
  });
});
