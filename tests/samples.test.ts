// Sample sites: the copy fences, the deterministic page with no leak, one open draft per lead,
// and a person's review.
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { writeLead, type Actor } from "@/lib/leads";
import { areaMap, checkCopy, closeRequest, requestsOf, listSamples, listingFacts, pickTemplate, publishQueue, renderSample, starterPrice, reportPublish, reviewSample, sampleHtml, sampleSlug, saveDraft } from "@/lib/samples";
import { leads } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { socialUrl } from "@/lib/leads";
import { createTenant } from "@/lib/tenants";
import { saveRates } from "@/lib/assets";
import { HUMAN_REQUEST_ONLY, sampleFooter } from "@/lib/samples";

const COPY = {
  headline: "Fresh tacos, made to order",
  intro: "A neighbourhood taqueria serving Astoria with tacos, burritos and aguas frescas, seven days a week.",
  noticed: "Customers can only find you through your Google listing today.",
  sections: [
    { title: "What we make", body: "Tacos al pastor, carnitas and grilled vegetables, with tortillas pressed every morning." },
    { title: "Come by", body: "Walk in for a quick lunch or order for the whole office; we are open every day." },
  ],
  cta: "Message us on WhatsApp",
};
const NOMAP = async () => "";
const LEAD = { contactPerson: "Maria Lopez", businessEmail: "hola@tacoloco.example", address: "31-15 Steinway St, Astoria" };

describe("checkCopy", () => {
  it("takes good copy and says why it refuses the rest", () => {
    expect(checkCopy(COPY, LEAD)).toMatchObject({ ok: true });
    const bad = (patch: object) => checkCopy({ ...COPY, ...patch }, LEAD);
    expect(bad({ headline: "x".repeat(80) })).toMatchObject({ ok: false, error: expect.stringMatching(/headline is 80 characters/) });
    expect(bad({ intro: "See tacoloco.com for more" })).toMatchObject({ ok: false, error: expect.stringMatching(/web address/) });
    expect(bad({ intro: "Write to hola@tacoloco.example" })).toMatchObject({ ok: false, error: expect.stringMatching(/email/) });
    expect(bad({ intro: "Call us at (718) 555-0100 today" })).toMatchObject({ ok: false, error: expect.stringMatching(/phone/) });
    expect(bad({ intro: "Tacos from $3 every day of the week" })).toMatchObject({ ok: false, error: expect.stringMatching(/price/) });
    expect(bad({ intro: "The best tacos in Queens, every single day" })).toMatchObject({ ok: false, error: expect.stringMatching(/claim/) });
    expect(bad({ intro: 'A guest wrote "the most amazing tacos I have had"' })).toMatchObject({ ok: false, error: expect.stringMatching(/quotes/) });
    expect(bad({ intro: "Maria welcomes you with fresh tacos daily" })).toMatchObject({ ok: false, error: expect.stringMatching(/names a person \(Maria\)/) });
    expect(bad({ sections: [COPY.sections[0]] })).toMatchObject({ ok: false, error: expect.stringMatching(/two or three sections/) });
  });
});

describe("the page", () => {
  const lead = { business: "Taco Loco | 타코 | Mexican", industry: "Mexican restaurant", city: "Astoria", state: "NY", whatsapp: "https://wa.me/17185550100",
    mapLink: "https://maps.app.goo.gl/abc", listingEvidence: "Google listing: 4.6★ (212 reviews), Mexican restaurant, open 7 days" };

  it("is built from the row: the rating with its Maps link, the area, the WhatsApp button; noindex and the footer", () => {
    const html = renderSample(lead, pickTemplate(lead.industry), checkCopy(COPY, LEAD).ok ? COPY : COPY);
    expect(html).toContain("<h1>Taco Loco</h1>");
    expect(html).toContain('href="https://maps.app.goo.gl/abc"');
    expect(html).toContain("4.6★ from 212 reviews on Google Maps");
    expect(html).toContain("Serving Astoria, NY");
    expect(html).toContain('class="cta" href="https://wa.me/17185550100"');
    expect(html).toContain('<meta name="robots" content="noindex,nofollow">');
    expect(html).toContain("A free sample for Taco Loco. Not the business's official site.");
    expect(sampleFooter("Taco Loco", "", "Acme Sites")).toContain("A free sample made by Acme Sites for Taco Loco. Not the business's official site. The full website from Acme Sites: priced after a short call.");
    expect(html).not.toMatch(/<script/i);
    expect(Buffer.byteLength(html)).toBeLessThan(30 * 1024);
  });

  it("leaks nothing personal and escapes what it shows", () => {
    const html = renderSample({ ...lead, business: 'Taco <b>"Loco"</b>', whatsapp: "javascript:alert(1)", mapLink: "https://evil.example/maps" }, "restaurant", COPY);
    for (const leak of ["Maria", "hola@", "Steinway", "javascript:", "evil.example", "<b>"]) expect(html).not.toContain(leak);
    expect(html).toContain("Taco &lt;b&gt;&quot;Loco&quot;&lt;/b&gt;");
  });

  it("picks a template by trade, reads the listing line, makes an unguessable slug", () => {
    expect([pickTemplate("Mexican restaurant"), pickTemplate("Women's clothing store"), pickTemplate("Nail salon"), pickTemplate("Plumber"), pickTemplate("Museum")])
      .toEqual(["eat", "shop", "care", "services", "plain"]);      // the five families
    expect(listingFacts("Google listing: no reviews yet, Men's clothing store, open 5 days (closed Friday, Saturday), no website on the listing"))
      .toEqual({ kind: "Men's clothing store", open: "Open 5 days (closed Friday, Saturday)" });
    expect(sampleSlug("Taco Loco | Mexican", "Astoria, NY", "k3f9")).toBe("taco-loco-astoria-k3f9");
  });
});

describe("drafts and reviews", () => {
  it("one open draft per lead, a sent-back draft replaced as the next version, a person's decision ends the turn", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const r = await writeLead(db, tenant.id, {}, { business: "Taco Loco", industry: "Mexican restaurant", city: "Astoria", whatsapp: "https://wa.me/17185550100",
      contact_person: "Maria Lopez", package: "Starter Website", listing_evidence: "Google listing: 4.6★ (212 reviews), Mexican restaurant, open 7 days" }, OLU, { create: true });
    if (!r.ok) throw new Error(r.message);
    const id = r.lead.id;
    const first = await saveDraft(db, tenant.id, id, undefined, COPY, "Site Builder", NOMAP);
    expect(first).toMatchObject({ status: "draft", version: 1, template: "eat", draftedBy: "Site Builder" });
    expect(await sampleHtml(db, tenant.id, first.id)).toContain("Fresh tacos, made to order");
    await expect(saveDraft(db, tenant.id, id, "restaurant", COPY, "Site Builder", NOMAP)).rejects.toThrow(/waiting for a person/);
    await expect(saveDraft(db, tenant.id, id, "restaurant", { ...COPY, intro: "Maria makes it all" }, "Site Builder", NOMAP)).rejects.toThrow(/names a person/);
    await expect(reviewSample(db, tenant.id, first.id, "changes", { name: "Olu" }, "")).rejects.toThrow(/say what to change/);
    const back = await reviewSample(db, tenant.id, first.id, "changes", { name: "Olu" }, "Say they cater for offices too");
    expect(back).toMatchObject({ status: "changes_requested", note: "Say they cater for offices too", reviewedBy: "Olu" });
    expect((await listSamples(db, tenant.id, { status: ["changes_requested"] })).map((s) => s.note)).toEqual(["Say they cater for offices too"]);
    const second = await saveDraft(db, tenant.id, id, "restaurant", COPY, "Site Builder", NOMAP);
    // a newer version alone closes no request; a person (or a list of answers) does
    expect(second).toMatchObject({ id: first.id, status: "changes_requested", version: 2 });
    const [asked] = await requestsOf(db, tenant.id, first.id, "open");
    await closeRequest(db, tenant.id, first.id, asked.id, "done", { name: "Olu", userId: owner.id, role: "owner" });
    expect(await reviewSample(db, tenant.id, first.id, "approve", { name: "Olu" })).toMatchObject({ status: "approved" });
    // an approved sample takes no new version without a signed-in person's request
    await expect(saveDraft(db, tenant.id, id, "restaurant", COPY, "Site Builder", NOMAP)).rejects.toThrow(HUMAN_REQUEST_ONLY);
    expect(await reviewSample(db, tenant.id, first.id, "takedown", { name: "Olu" })).toMatchObject({ status: "taken_down" });
    await expect(saveDraft(db, tenant.id, id, "restaurant", COPY, "Site Builder", NOMAP)).rejects.toThrow(/taken down: a person decides/);
    await expect(saveDraft(db, tenant.id, "00000000-0000-0000-0000-000000000000", "general", COPY, "x", NOMAP)).rejects.toThrow(/no such lead/);
  });
});


describe("the owner's later additions", () => {
  const lead = { business: "Luna Salon", industry: "Nail salon", city: "Astoria", state: "NY", whatsapp: "https://wa.me/17185550100", mapLink: "https://maps.app.goo.gl/x" };

  it("a drawn illustration, a photos spot, the Maps button; social icons only when filled; the area map embedded with its credit", () => {
    const plain = renderSample(lead, "salon", COPY);
    expect(plain).toContain("<svg viewBox=\"0 0 120 120\"");
    expect(plain).toContain("Your photos go here");
    expect(plain).toContain('class="btn2" href="https://maps.app.goo.gl/x"');
    expect(plain).not.toContain('aria-label="Instagram"');
    expect(plain).not.toContain("OpenStreetMap");
    const full = renderSample({ ...lead, instagramUrl: "https://www.instagram.com/lunasalon", facebookUrl: "https://evil.example/x" }, "salon", COPY,
      { mapImage: "data:image/png;base64,iVBORw0KGgo=" });
    expect(full).toContain('href="https://www.instagram.com/lunasalon"');
    expect(full).not.toContain("evil.example");
    expect(full).toContain('<img src="data:image/png;base64,iVBORw0KGgo=" alt="Map of Astoria, NY"');
    expect(full).toContain("© OpenStreetMap contributors");
    expect(renderSample(lead, "salon", COPY, { mapImage: "https://tile.example/1.png" })).not.toContain("tile.example");
  });

  it("areaMap: one geocode and one tile, embedded; nothing when OSM does not answer", async () => {
    const calls: string[] = [];
    const fake = (async (url: string) => {
      calls.push(url);
      if (url.includes("nominatim")) return new Response(JSON.stringify([{ lat: "40.7644", lon: "-73.9235" }]), { headers: { "content-type": "application/json" } });
      return new Response(new Uint8Array([137, 80, 78, 71]), { headers: { "content-type": "image/png" } });
    }) as unknown as typeof fetch;
    expect(await areaMap("Astoria, NY", fake)).toBe("data:image/png;base64,iVBORw==");
    expect(calls[0]).toContain("q=Astoria%2C%20NY");
    expect(calls[1]).toMatch(/^https:\/\/tile\.openstreetmap\.org\/13\/\d+\/\d+\.png$/);
    expect(await areaMap("", fake)).toBe("");
    expect(await areaMap("Nowhere", (async () => { throw new Error("offline"); }) as unknown as typeof fetch)).toBe("");
  });

  it("the Instagram and Facebook cells take only the business's page on that site", () => {
    expect(socialUrl("instagram_url", "https://instagram.com/lunasalon/")).toEqual({ value: "https://instagram.com/lunasalon" });
    expect(socialUrl("facebook_url", "https://m.facebook.com/LunaSalonNY")).toEqual({ value: "https://m.facebook.com/LunaSalonNY" });
    expect(socialUrl("instagram_url", "http://instagram.com/x")).toMatchObject({ error: expect.any(String) });
    expect(socialUrl("facebook_url", "https://facebook.com/")).toMatchObject({ error: expect.any(String) });
    expect(socialUrl("instagram_url", "https://evil.example/instagram.com/x")).toMatchObject({ error: expect.any(String) });
  });
});


describe("publishing (379b)", () => {
  it("the queue holds approved and live pages, the publisher's reports move them, the lead's cell follows unless a person set it", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const mk = async (business: string, extra: Record<string, unknown> = {}) => {
      const r = await writeLead(db, tenant.id, {}, { business, industry: "Mexican restaurant", city: "Astoria", whatsapp: "https://wa.me/17185550100", ...extra }, OLU, { create: true });
      if (!r.ok) throw new Error(r.message);
      const s = await saveDraft(db, tenant.id, r.lead.id, undefined, COPY, "Site Builder", NOMAP);
      return { lead: r.lead.id, s };
    };
    const a = await mk("Taco Loco");
    const b = await mk("Luna Cafe", { sample_url: "https://luna.example/own" });
    expect(await publishQueue(db, tenant.id)).toEqual([]);                 // drafts are not published
    await reviewSample(db, tenant.id, a.s.id, "approve", { name: "Olu" });
    await reviewSample(db, tenant.id, b.s.id, "approve", { name: "Olu" });
    const q = await publishQueue(db, tenant.id);
    expect(q.map((x) => x.status)).toEqual(["approved", "approved"]);
    expect(q[0].html).toContain("Fresh tacos, made to order");
    const url = `https://acme-samples.pages.dev/${a.s.slug}/`;
    await expect(reportPublish(db, tenant.id, a.s.id, "published", "https://evil.example/x/")).rejects.toThrow(/pages\.dev/);
    await expect(reportPublish(db, tenant.id, a.s.id, "published", `https://acme-samples.pages.dev/other-slug/`)).rejects.toThrow(/slug/);
    const t0 = new Date("2026-11-10T10:00:00Z");
    expect(await reportPublish(db, tenant.id, a.s.id, "published", url, t0)).toMatchObject({ status: "live", url, reviewedBy: "Olu" });
    await reportPublish(db, tenant.id, b.s.id, "published", `https://acme-samples.pages.dev/${b.s.slug}/`, t0);
    const cell = async (id: string) => (await db.select({ u: leads.sampleUrl }).from(leads).where(eq(leads.id, id)))[0].u;
    expect(await cell(a.lead)).toBe(url);
    expect(await cell(b.lead)).toBe("https://luna.example/own");          // a person's link stays
    await expect(reportPublish(db, tenant.id, a.s.id, "expired", "", new Date("2026-11-20T10:00:00Z"))).rejects.toThrow(/30 days/);
    const late = new Date("2026-12-11T10:00:00Z");
    expect((await publishQueue(db, tenant.id, late)).find((x) => x.id === a.s.id)).toMatchObject({ expired: true });
    expect(await reportPublish(db, tenant.id, a.s.id, "expired", "", late)).toMatchObject({ status: "taken_down", note: "expired after 30 days", url });
    const gone = (await publishQueue(db, tenant.id, late)).find((x) => x.id === a.s.id);
    expect(gone).toMatchObject({ status: "taken_down", html: "" });       // still on the web: the publisher drops it
    expect(await reportPublish(db, tenant.id, a.s.id, "unpublished", "", late)).toMatchObject({ url: "" });
    expect(await cell(a.lead)).toBe(null);
    expect((await publishQueue(db, tenant.id, late)).find((x) => x.id === a.s.id)).toBeUndefined();
    await expect(reportPublish(db, tenant.id, b.s.id, "unpublished", "")).rejects.toThrow(/taken-down/);
  });
});


describe("the Site Builder's rules", () => {
  it("the footer offers the full site at the owner's Rates price or after a call; a business with a website gets no sample, and one that gets a site later is withdrawn", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const r = await writeLead(db, tenant.id, {}, { business: "Taco Loco", industry: "Mexican restaurant", city: "Astoria" }, OLU, { create: true });
    if (!r.ok) throw new Error(r.message);
    const first = await saveDraft(db, tenant.id, r.lead.id, undefined, COPY, "Site Builder", NOMAP);
    expect(await sampleHtml(db, tenant.id, first.id)).toContain("The full website: priced after a short call.");
    await reviewSample(db, tenant.id, first.id, "changes", { name: "Olu" }, "warmer intro");
    await saveRates(db, tenant.id, [{ line: "Starter Website: $990 one-time, $99/month care optional" }], "Olu");
    const second = await saveDraft(db, tenant.id, r.lead.id, undefined, COPY, "Site Builder", NOMAP);
    expect(await sampleHtml(db, tenant.id, second.id)).toContain("The full website: $990 one-time, $99/month care optional.");
    await saveRates(db, tenant.id, [{ line: "Starter Website: $990 one-time for a one-page site built from your listing; a free sample first; $99/month care optional" }], "Olu");
    // the first clause only
    expect(await starterPrice(db, tenant.id)).toBe("$990 one-time for a one-page site built from your listing");
    await expect(reportPublish(db, tenant.id, second.id, "withdrawn", "")).rejects.toThrow(/now has a website/);
    await writeLead(db, tenant.id, { id: r.lead.id }, { website: "https://tacoloco.example" }, OLU);
    expect((await publishQueue(db, tenant.id)).find((x) => x.id === second.id)).toMatchObject({ status: "changes_requested", withdraw: true, html: "" });
    expect(await reportPublish(db, tenant.id, second.id, "withdrawn", "")).toMatchObject({ status: "taken_down", note: "the business has its own website now" });
    const r2 = await writeLead(db, tenant.id, {}, { business: "Has Site", website: "https://hassite.example", city: "Astoria" }, OLU, { create: true });
    if (!r2.ok) throw new Error(r2.message);
    await expect(saveDraft(db, tenant.id, r2.lead.id, undefined, COPY, "Site Builder", NOMAP)).rejects.toThrow(/has a website/);
  });
});
