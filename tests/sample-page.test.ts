// The Site Builder's own page: the checks, the CSP, a page draft that improves a waiting
// one, Reject, the queue's site facts and footer, the pictures copied at Approve, and the publish queue's assets; with
// areaOf never reading the street.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { writeLead, getLead, type Actor } from "@/lib/leads";
import { checkPage, cleanSources, copyImages, outsideImages, pageCsp, rewriteAssets } from "@/lib/sample-page";
import { areaOf, listSamples, publishQueue, reviewSample, sampleCards, sampleDoc, sampleFooter, sampleQueue, sampleSlug, saveDraft, sampleVersionsOf } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";

const FOOT = sampleFooter("Taco Loco", "");
const page = (body: string, head = "") =>
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Taco Loco</title>${head}</head><body>${body}${FOOT}</body></html>`;
const MENU = `<nav><button id="m">Menu</button><ul id="l" hidden><li>Tacos</li></ul></nav><script>document.getElementById("m").addEventListener("click",()=>{const l=document.getElementById("l");l.hidden=!l.hidden})</script>`;
const PHOTO = "https://lh3.googleusercontent.com/p/abc=w800";
const LEAD = { address: "31-15 Steinway St, Astoria, NY 11103", phone: "(718) 555-0100", businessEmail: "hola@tacoloco.example", contactPerson: "Maria Lopez" };
const NOMAP = async () => "";

describe("checkPage", () => {
  it("keeps a good page as it is, adds noindex, and lists its picture hosts", () => {
    const r = checkPage(page(`<h1>Taco Loco</h1><img src="${PHOTO}" alt="">${MENU}`, `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">`), LEAD);
    expect(r).toMatchObject({ ok: true, hosts: ["lh3.googleusercontent.com"] });
    if (r.ok) expect(r.html).toMatch(/<head><meta name="robots" content="noindex">/);
  });
  it("refuses what the 476b rule and the CSP keep off a page, with a reason", () => {
    const no = (html: string, sources: { fact: string; from: string }[] = []) => {
      const r = checkPage(html, LEAD, sources);
      return r.ok ? "ok" : r.error;
    };
    expect(no(page("<p>Find us at 31-15 Steinway St</p>"))).toMatch(/street address/);
    expect(no(page("<p>Call 718 555 0100</p>"))).toMatch(/phone/);
    // the WhatsApp button's wa.me link may carry the phone (its WhatsApp is its phone); the number elsewhere may not
    // a wa.me button only for a verified WhatsApp (an unverified one is refused for the button)
    const verified = (html: string) => { const r = checkPage(html, { ...LEAD, whatsappStatus: "WhatsApp Verified" }); return r.ok ? "ok" : r.error; };
    expect(verified(page(`<h1>Taco Loco</h1><img src="${PHOTO}" alt=""><a href="https://wa.me/17185550100">WhatsApp</a>`))).toBe("ok");
    expect(verified(page('<a href="https://wa.me/17185550100">WhatsApp</a><p>or 718-555-0100</p>'))).toMatch(/phone/);
    expect(no(page(`<h1>Taco Loco</h1><a href="https://wa.me/17185550100">WhatsApp</a>`))).toMatch(/has not verified/);
    // the contact rules are the engine's shared cases now (tests/sample-shared-cases.test.ts); a tel: link outside the
    // contact section is refused, the business's own number inside it is fine
    expect(no(page('<a href="tel:7185550100">call</a><p>more</p>'))).toMatch(/phone/);
    expect(no(page("<p>hola@tacoloco.example</p>"))).toMatch(/email/);
    expect(no(page("<p>Maria welcomes you</p>"))).toMatch(/names a person \(Maria\)/);
    expect(no(page(`${MENU}<script>1</script>`))).toMatch(/2 scripts/);
    expect(no(page('<script src="https://x.example/a.js"></script>'))).toMatch(/script src/);
    expect(no(page("<script>fetch('/x')</script>"))).toMatch(/may not use fetch/);
    expect(no(page("<script>document.cookie</script>"))).toMatch(/document\.cookie/);
    expect(no(page('<button onclick="x()">Menu</button>'))).toMatch(/onclick/);
    expect(no(page('<form action="/x"></form>'))).toMatch(/<form>/);
    expect(no(page('<iframe src="https://x.example"></iframe>'))).toMatch(/<iframe>/);
    expect(no(page('<img src="https://s3-media0.fl.yelpcdn.com/x.jpg">'))).toMatch(/picture from/); // no Yelp (owner)
    expect(no(page('<img src="http://lh3.googleusercontent.com/x">'))).toMatch(/picture from/);
    expect(no(page("", '<link rel="stylesheet" href="https://cdn.example/x.css">'))).toMatch(/only Google Fonts/);
    expect(no(page('<div style="background:url(https://evil.example/x.png)"></div>'))).toMatch(/picture from/);
    expect(no(page('<a href="javascript:alert(1)">x</a>'))).toMatch(/javascript:/);
    expect(no(page("x".repeat(301 * 1024)))).toMatch(/at most 300 KB/);
    expect(no("<p>no document</p>")).toMatch(/whole document/);
    // no footer note is required
    expect(no(page("").replace("Not the business's official site", "A page"))).toBe("ok");
    // a host the sources name is allowed
    expect(no(page('<img src="https://media.example-cafe.com/a.jpg">'), [{ fact: "photos", from: "https://media.example-cafe.com/gallery" }])).toBe("ok");
  });
  it("cleans the sources", () => {
    expect(cleanSources([{ fact: "hours", from: "https://maps.google.com/x" }, { fact: "x", from: "javascript:1" }, "no", { fact: "", from: "https://a" }])).toEqual([{ fact: "hours", from: "https://maps.google.com/x" }]);
  });
});

describe("pageCsp", () => {
  it("a builder page: its one script by hash, its photo hosts, Google Fonts, sandboxed; a template page no script", () => {
    const html = page(`<img src="${PHOTO}">${MENU}`);
    const csp = pageCsp(html, "page");
    expect(csp).toMatch(/script-src 'sha256-[A-Za-z0-9+/=]+'/);
    expect(csp).toMatch(/img-src data: https:\/\/lh3\.googleusercontent\.com/);
    expect(csp).toMatch(/font-src https:\/\/fonts\.gstatic\.com/);
    expect(csp).toMatch(/connect-src 'none'/);
    expect(csp).toMatch(/sandbox allow-popups allow-popups-to-escape-sandbox allow-scripts$/);
    expect(pageCsp("<p>x</p>", "page")).toMatch(/script-src 'none'/);
    expect(pageCsp(html, "template")).toBe("default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox allow-popups allow-popups-to-escape-sandbox");
  });
});

describe("areaOf", () => {
  it("the city and state columns only; with no city the state alone, else nothing; never the location's street", () => {
    expect(areaOf({ business: "x", city: "Astoria", state: "NY", location: "31-15 Steinway St, Astoria, NY" })).toBe("Astoria, NY");
    expect(areaOf({ business: "x", state: "NY", location: "31-15 Steinway St, Astoria, NY" })).toBe("NY");
    expect(areaOf({ business: "x", location: "31-15 Steinway St" })).toBe("");
    expect(sampleSlug("Taco Loco", areaOf({ business: "x", location: "31-15 Steinway St" }), "ab12")).not.toMatch(/steinway/);
  });
});

describe("the Site Builder's page on Peek", () => {
  const setup = async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const r = await writeLead(db, tenant.id, {}, { business: "Taco Loco", industry: "Mexican restaurant", location: "31-15 Steinway St, Astoria, NY 11103",
      whatsapp: "https://wa.me/17185550100", phone: "(718) 555-0100", contact_person: "Maria Lopez", package: "Starter Website" }, OLU, { create: true });
    if (!r.ok) throw new Error(r.message);
    return { db, t: tenant.id, lead: String(r.lead.id), OLU };
  };
  const body = (v: number) => page(`<h1>Taco Loco v${v}</h1><img src="${PHOTO}">${MENU}`);

  it("site facts: written whole by the Enricher, read back, and in the queue item with the footer", async () => {
    const { db, t, lead } = await setup();
    const bot: Actor = { kind: "bot", name: "Lead Enricher", via: "key" } as Actor;
    const w = await writeLead(db, t, { id: lead }, { siteFacts: { area: "Astoria, NY", hours: "Mon-Sun 10-22", photos: [{ url: PHOTO, source: "maps" }] } }, bot, { fillOnly: true });
    expect(w).toMatchObject({ ok: true, written: ["site_facts"] });
    // a newer write replaces the whole object, fill_only or not
    await writeLead(db, t, { id: lead }, { siteFacts: { hours: "Mon-Sat 11-21" } }, bot, { fillOnly: true });
    expect((await getLead(db, t, { id: lead }))?.site_facts).toEqual({ hours: "Mon-Sat 11-21" });
    expect(await writeLead(db, t, { id: lead }, { siteFacts: [1] }, bot)).toMatchObject({ ok: false, message: /one JSON object/ });
    const [item] = await sampleQueue(db, t, 5, NOMAP);
    expect(item.facts.siteFacts).toEqual({ hours: "Mon-Sat 11-21" });
    expect(item.facts.footer).toBe(sampleFooter("Taco Loco", ""));
  });

  it("a page draft is kept as written; a better one replaces the waiting draft; Reject drops the lead with the reason", async () => {
    const { db, t, lead } = await setup();
    const sig = { palette: ["#c2410c"], fonts: ["Inter"], sections: ["hero", "offers"], headline: "warm market" };
    const one = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: body(1), changes: "first draft", sources: [{ fact: "hours", from: "https://maps.google.com/x" }], signature: sig, designReason: "For office lunch crowds: warm orange, Inter, offers first." });
    expect(one).toMatchObject({ kind: "page", status: "draft", version: 1, changes: "first draft", signature: sig, designReason: expect.stringMatching(/office lunch/) });
    expect((await sampleDoc(db, t, one.id))?.html).toContain("Taco Loco v1");
    expect(one.slug).not.toMatch(/steinway/);
    const two = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: body(2), changes: "photos up top" });
    expect(two).toMatchObject({ id: one.id, version: 2, status: "draft", changes: "photos up top" });
    expect((await sampleVersionsOf(db, t, one.id)).map((v) => v.version)).toEqual([2, 1]);
    await expect(saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>31-15 Steinway St</p>") })).rejects.toThrow(/street address/);
    // the card shows it, and the v1 list carries the signature and the design reason
    const [card] = (await sampleCards(db, t)).cards;
    expect(card).toMatchObject({ kind: "page", changes: "photos up top", version: 2 });
    expect((await listSamples(db, t))[0]).toHaveProperty("signature");
    // reject: out of the queue, the reason readable as the row's note
    expect(await reviewSample(db, t, one.id, "reject", { name: "Olu" }, "Too dark for a taqueria")).toMatchObject({ status: "rejected", note: "Too dark for a taqueria" });
    expect((await sampleQueue(db, t, 20, NOMAP)).map((i) => i.leadId)).not.toContain(lead);
    expect((await listSamples(db, t, { status: ["rejected"] }))[0].note).toBe("Too dark for a taqueria");
    await expect(saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: body(3) })).rejects.toThrow(/rejected/);
    await expect(reviewSample(db, t, one.id, "reject", { name: "Olu" })).rejects.toThrow(/only a draft is rejected/);
  });

  it("a waiting template draft comes back as recopy once its site facts are in", async () => {
    const { db, t, lead, OLU } = await setup();
    const COPY = { headline: "Fresh tacos, made to order", about: "A neighbourhood taqueria with tacos and aguas frescas, every day of the week.", cta: "Message us on WhatsApp" };
    const s = await saveDraft(db, t, lead, "eat", COPY, "Site Builder", NOMAP);
    expect((await sampleQueue(db, t, 20, NOMAP)).find((i) => i.leadId === lead)).toBeUndefined();
    await writeLead(db, t, { id: lead }, { siteFacts: { hours: "Mon-Sun 10-22" } }, OLU);
    expect((await sampleQueue(db, t, 20, NOMAP)).find((i) => i.leadId === lead)).toMatchObject({ reason: "recopy", sampleId: s.id });
    // its page replaces the waiting template draft
    expect(await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: body(1) })).toMatchObject({ id: s.id, kind: "page", version: 2 });
    expect((await sampleQueue(db, t, 20, NOMAP)).find((i) => i.leadId === lead)).toBeUndefined();
  });

  it("Approve refuses a picture not uploaded through Peek (750); a page approved earlier keeps its copies in the publish queue", async () => {
    const { samples } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const { db, t, lead } = await setup();
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: body(1) });
    const kept = new Map<string, Uint8Array>();
    const put = async (k: string, b: Uint8Array) => void kept.set(k, b);
    const ok = async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/jpeg" } });
    await expect(reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", { put, get: ok as unknown as typeof fetch })).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^1 picture on this page was not uploaded through Peek.*Nothing was approved/) });
    expect([...kept.keys()]).toEqual([]);
    expect((await db.select().from(samples).where(eq(samples.id, s.id)))[0]).toMatchObject({ status: "draft", approvedVersion: null, assets: [] });
    expect(await publishQueue(db, t, new Date(), async (key) => key)).toEqual([]);
    await db.update(samples).set({ status: "approved", approvedVersion: 1, reviewedBy: "Olu", assets: [{ src: PHOTO, path: "assets/1.jpg", key: `samples/${s.id}/v1/1.jpg`, type: "image/jpeg" }] }).where(eq(samples.id, s.id));
    const [item] = await publishQueue(db, t, new Date(), async (key) => `https://bucket.example/${key}?sig=1`);
    expect(item.html).toContain('src="assets/1.jpg"');
    expect(item.html).not.toContain(PHOTO);
    expect(item.assets).toEqual([{ path: "assets/1.jpg", url: `https://bucket.example/samples/${s.id}/v1/1.jpg?sig=1` }]);
    // the preview keeps the original address
    expect((await sampleDoc(db, t, s.id))?.html).toContain(PHOTO);
  });

  it("copyImages refuses a host that is not a photo host, and rewriteAssets swaps every use", async () => {
    await expect(copyImages('<img src="https://evil.example/x.jpg">', [], "p", async () => {})).rejects.toThrow(/not a photo host/);
    const html = `<img src="${PHOTO}"><div style="background:url(${PHOTO})"></div>`;
    expect(outsideImages(html)).toEqual([PHOTO]);
    expect(rewriteAssets(html, [{ src: PHOTO, path: "assets/1.jpg", key: "k", type: "image/jpeg" }])).toBe('<img src="assets/1.jpg"><div style="background:url(assets/1.jpg)"></div>');
  });
});

describe("the owner's note from the dashboard", () => {
  it("a draft goes back with it, a live page carries it and keeps its status; the queue lists both as changes; taken down is refused", async () => {
    const { ownerNote } = await import("@/lib/samples");
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const mk = async (business: string) => {
      const r = await writeLead(db, tenant.id, {}, { business, industry: "Bakery", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100" }, OLU, { create: true });
      if (!r.ok) throw new Error(r.message);
      return String(r.lead.id);
    };
    const pageOf = (name: string) => `<!doctype html><html lang="en"><head><title>${name}</title></head><body><h1>${name}</h1>${sampleFooter(name, "")}</body></html>`;
    const a = await saveDraft(db, tenant.id, await mk("Alpha Bakery"), "eat", undefined, "Site Builder", NOMAP, { html: pageOf("Alpha Bakery") });
    expect(await ownerNote(db, tenant.id, a.id, "Bigger photos of the bread", "Owner (dashboard)")).toMatchObject({ status: "changes_requested", note: "Bigger photos of the bread", reviewedBy: "Owner (dashboard)" });
    const bLead = await mk("Beta Bakery");
    const b = await saveDraft(db, tenant.id, bLead, "eat", undefined, "Site Builder", NOMAP, { html: pageOf("Beta Bakery") });
    await reviewSample(db, tenant.id, b.id, "approve", { name: "Olu" }, "", { put: async () => {} });
    expect(await ownerNote(db, tenant.id, b.id, "Add the opening hours", "Owner (dashboard)")).toMatchObject({ status: "approved", changesNote: "Add the opening hours" });
    const q = await sampleQueue(db, tenant.id, 20, NOMAP);
    expect(q.filter((i) => i.reason === "changes").map((i) => i.note).sort()).toEqual(["Add the opening hours", "Bigger photos of the bread"]);
    await reviewSample(db, tenant.id, b.id, "takedown", { name: "Olu" });
    await expect(ownerNote(db, tenant.id, b.id, "x", "Owner")).rejects.toThrow(/taken down/);
    await expect(ownerNote(db, tenant.id, a.id, "  ", "Owner")).rejects.toThrow(/send the note/);
  });
});

describe("deleting a dead sample and reopening", () => {
  it("only taken down or rejected; versions, row and copied pictures go, one audit line stays, the lead stays out of the queue until reopened", async () => {
    const { deleteSample, reopenSample } = await import("@/lib/samples");
    const { sampleDeletions, sampleVersions, samples, leads } = await import("@/lib/db/schema");
    const { eq } = await import("drizzle-orm");
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const r = await writeLead(db, tenant.id, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, OLU, { create: true });
    if (!r.ok) throw new Error(r.message);
    const lead = String(r.lead.id);
    const page = (v: number) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill v${v}</h1><img src="${PHOTO}">${sampleFooter("Gamma Grill", "")}</body></html>`;
    const s = await saveDraft(db, tenant.id, lead, "eat", undefined, "Site Builder", NOMAP, { html: page(1) });
    await saveDraft(db, tenant.id, lead, "eat", undefined, "Site Builder", NOMAP, { html: page(2) });
    // a page approved before the photo checks, with the copy it made then
    await db.update(samples).set({ status: "approved", approvedVersion: 2, reviewedBy: "Olu", assets: [{ src: PHOTO, path: "assets/1.jpg", key: `samples/${s.id}/v2/1.jpg`, type: "image/jpeg" }] }).where(eq(samples.id, s.id));
    await expect(deleteSample(db, tenant.id, s.id, "Olu", null)).rejects.toThrow(/only a taken-down or rejected sample/);
    await reviewSample(db, tenant.id, s.id, "takedown", { name: "Olu" });
    const removed: string[] = [];
    expect(await deleteSample(db, tenant.id, s.id, "Olu", async (k) => void removed.push(k))).toEqual({ slug: s.slug, versions: 2, files: 1 });
    expect(removed).toEqual([`samples/${s.id}/v2/1.jpg`]);
    expect(await db.select().from(samples).where(eq(samples.id, s.id))).toEqual([]);
    expect(await db.select().from(sampleVersions).where(eq(sampleVersions.sampleId, s.id))).toEqual([]);
    expect(await db.select().from(sampleDeletions)).toMatchObject([{ sampleId: s.id, slug: s.slug, business: "Gamma Grill", versions: 2, deletedBy: "Olu", reopenedAt: null }]);
    // the lead is untouched and out of the queue; no draft for it until it is reopened
    expect((await db.select().from(leads).where(eq(leads.id, lead)))[0].business).toBe("Gamma Grill");
    expect((await sampleQueue(db, tenant.id, 20, NOMAP)).map((i) => i.leadId)).not.toContain(lead);
    await expect(saveDraft(db, tenant.id, lead, "eat", undefined, "Site Builder", NOMAP, { html: page(3) })).rejects.toThrow(/deleted this lead's sample/);
    expect(await reopenSample(db, tenant.id, lead, "Site Builder")).toEqual({ reopened: "deleted", sample: null });
    expect((await sampleQueue(db, tenant.id, 20, NOMAP)).map((i) => i.leadId)).toContain(lead);
    const fresh = await saveDraft(db, tenant.id, lead, "eat", undefined, "Site Builder", NOMAP, { html: page(3) });
    // a rejected one reopens as sent back, listed as changes
    await reviewSample(db, tenant.id, fresh.id, "reject", { name: "Olu" }, "too dark");
    expect(await reopenSample(db, tenant.id, lead, "Site Builder")).toMatchObject({ reopened: "sample", sample: { status: "changes_requested" } });
    expect((await sampleQueue(db, tenant.id, 20, NOMAP)).find((i) => i.leadId === lead)).toMatchObject({ reason: "changes" });
    await expect(reopenSample(db, tenant.id, lead, "x")).rejects.toThrow(/already open/);
  });

  it("the card shows Delete to the owner only, on dead samples; the route checks the owner role", () => {
    const v = readFileSync(`${process.cwd()}/app/samples/sample-cards.tsx`, "utf8");
    // Delete sits with Open site on a dead card, for the owner only
    expect(v).toMatch(/const dead = c\.status === "taken_down" \|\| c\.status === "rejected";/);
    expect(v).toMatch(/\{isOwner \? \(\s*<button[^>]*onClick=\{\(\) => void remove\(\)\}/);
    expect(v).toMatch(/Delete \$\{c\.business\}'s sample and all its versions\? This can't be undone\./);
    expect(readFileSync(`${process.cwd()}/app/api/samples/[id]/route.ts`, "utf8")).toMatch(/g\.who\.role !== "owner"/);
  });
});
