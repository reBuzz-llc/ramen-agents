// Change requests with pictures attached, each request its own: change
// requests on any sample not rejected or taken down, each its own record with up to three pictures (re-encoded, no
// metadata), answered by exactly the ids a version names; and the approved version staying on the web
// while a newer one waits -- for example: v17 approved, v18 arrived before the hourly run, and nothing went live.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { sampleRequests, tenants } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { references, setReference } from "@/lib/sample-references";
import { addSampleRequest, picturesProblem, reencode, requestPicture, requestView } from "@/lib/sample-requests";
import { openRequestCounts, ownerNote, publishQueue, reportPublish, requestsOf, reviewSample, saveDraft, sampleFooter } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";
import { askAsPerson, PERSON } from "./helpers/person-request";
import { HUMAN_REQUEST_ONLY } from "@/lib/samples";

const NOMAP = async () => "";
const page = (body: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1>${body}${sampleFooter("Gamma Grill", "")}</body></html>`;
const BOT: Actor = { kind: "bot", name: "Lead Enricher", via: "engine" };

async function setup(auto = false) {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  if (auto) await db.update(tenants).set({ settings: { samplesAutoPublish: true } }).where(eq(tenants.id, tenant.id));
  const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const r = await writeLead(db, tenant.id, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, OLU, { create: true });
  if (!r.ok) throw new Error(r.message);
  const lead = String(r.lead.id);
  const draft = (body: string, answers?: unknown) => saveDraft(db, tenant.id, lead, "eat", undefined, "Site Builder", NOMAP, { html: page(body), ...(answers !== undefined ? { answers } : {}) });
  const bump = (hours: string) => writeLead(db, tenant.id, { id: lead }, { siteFacts: { hours } }, BOT);
  return { db, t: tenant.id, lead, draft, bump };
}

describe("the approved version stays on the web", () => {
  it("an example: v1 approved, not yet up; v2 arrives before the run; v1 is still what goes up, and stays up", async () => {
    const { db, t, draft, bump } = await setup();
    const s = await draft("<p>first</p>");
    await reviewSample(db, t, s.id, "approve", { name: "Olu" });
    await bump("Mon-Sun 10-22");
    const v2 = await draft("<p>second</p>", [await askAsPerson(db, t, s.id)]);
    expect(v2).toMatchObject({ version: 2, status: "draft", approvedVersion: 1 });
    const [item] = await publishQueue(db, t);
    expect(item).toMatchObject({ id: s.id, status: "approved", version: 1 });
    expect(item.html).toContain("first");
    // the publisher reports it published: the address is kept, the newer version still waits
    const URL1 = `https://acme-samples.pages.dev/${item.slug}/`;
    const after = await reportPublish(db, t, s.id, "published", URL1);
    expect(after).toMatchObject({ status: "draft", url: URL1, version: 2, approvedVersion: 1 });
    expect((await publishQueue(db, t))[0]).toMatchObject({ status: "live", version: 1 });
    // approving the new one moves what is up
    await reviewSample(db, t, s.id, "approve", { name: "Olu" });
    expect((await publishQueue(db, t))[0]).toMatchObject({ status: "approved", version: 2, html: expect.stringContaining("second") });
  });

  it("a request on an approved sample keeps it approved; its next version is a draft, never live by itself; reject is refused while one is up", async () => {
    const { db, t, draft } = await setup();
    const s = await draft("<p>first</p>");
    await reviewSample(db, t, s.id, "approve", { name: "Olu" });
    const asked = await reviewSample(db, t, s.id, "changes", { name: "Olu", userId: PERSON }, "Say they cater too");
    expect(asked).toMatchObject({ status: "approved", changesNote: "Say they cater too", note: "Say they cater too" });
    const v2 = await draft("<p>catering too</p>", (await requestsOf(db, t, s.id, "open")).map((r) => r.id));
    expect(v2).toMatchObject({ status: "draft", version: 2, approvedVersion: 1 });
    expect(v2.answered).toHaveLength(1);
    await expect(reviewSample(db, t, s.id, "reject", { name: "Olu" })).rejects.toThrow(/version 1 is on the web/);
  });
});

describe("requests, each its own record", () => {
  it("a missing list or [] answers none; a list answers exactly those; the Decisions box note is one too", async () => {
    const { db, t, draft, bump } = await setup();
    const s = await draft("<p>v1</p>");
    await reviewSample(db, t, s.id, "approve", { name: "Olu" });
    const a = (await addSampleRequest(db, t, s.id, { text: "Bigger menu photos", byName: "Olu", byUser: PERSON })).request;
    await ownerNote(db, t, s.id, "Add the lunch special", "Owner (dashboard)");
    expect((await requestsOf(db, t, s.id)).map((r) => [r.text, r.status, r.madeOnVersion])).toEqual([["Add the lunch special", "open", 1], ["Bigger menu photos", "open", 1]]);
    // on an approved sample, a version that names no person's request is refused and closes nothing
    await bump("Mon-Sun 10-22");
    await expect(draft("<p>v2</p>", [])).rejects.toThrow(HUMAN_REQUEST_ONLY);
    expect((await openRequestCounts(db, t, [s.id])).get(s.id)).toEqual({ open: 2, withPictures: 0 });
    // the engine names the one it answered
    await bump("Mon-Sun 11-23");
    const v2 = await draft("<p>bigger photos</p>", [a.id]);
    expect(v2.answered).toEqual([a.id]);
    const rows = await requestsOf(db, t, s.id);
    expect(rows.map((r) => [r.text, r.status, r.answeredVersion])).toEqual([["Add the lunch special", "open", null], ["Bigger menu photos", "addressed", 2]]); // a round's word is a claim
    expect(v2.note).toBe("Add the lunch special"); // the older fields mirror the newest open request
    // a version that leaves one open is not approved past it
    expect(v2.status).toBe("changes_requested");
    await expect(reviewSample(db, t, s.id, "approve", { name: "Olu" })).rejects.toThrow(/still open/);
    // the one left came with a key (the Decisions box), so it does not open a new version, named or not
    await bump("Mon-Sun 12-23");
    await expect(draft("<p>lunch special</p>")).rejects.toThrow(HUMAN_REQUEST_ONLY);
    const [left] = await requestsOf(db, t, s.id, "open");
    await bump("Mon-Sun 13-23");
    await expect(draft("<p>lunch special, named</p>", [left.id])).rejects.toThrow(HUMAN_REQUEST_ONLY);
    expect((await requestsOf(db, t, s.id, "open")).map((r) => r.id)).toEqual([left.id]);
  });

  it("refused on a rejected or taken-down sample, and without words", async () => {
    const { db, t, draft } = await setup();
    const s = await draft("<p>v1</p>");
    await expect(addSampleRequest(db, t, s.id, { text: "  ", byName: "Olu" })).rejects.toThrow(/say what to change/);
    await reviewSample(db, t, s.id, "reject", { name: "Olu" });
    await expect(addSampleRequest(db, t, s.id, { text: "x", byName: "Olu" })).rejects.toThrow(/rejected: no next version/);
  });
});

describe("pictures on a request", () => {
  it("up to three, re-encoded with no metadata, kept privately, listed for the engine with needsHelper; read back by number", async () => {
    const sharp = (await import("sharp")).default;
    const jpg = new Uint8Array(await sharp({ create: { width: 8, height: 8, channels: 3, background: "#ff6600" } }).jpeg().withExif({ IFD0: { Make: "SecretCam", Model: "PhoneX" } }).toBuffer());
    expect(Buffer.from(jpg).includes("SecretCam")).toBe(true);
    const clean = await reencode(jpg, "image/jpeg");
    expect(Buffer.from(clean).includes("SecretCam")).toBe(false);
    const png = new Uint8Array(await sharp({ create: { width: 4, height: 4, channels: 4, background: "#000" } }).png().toBuffer());
    expect(picturesProblem([png, png, png, png])).toMatch(/at most 3/);
    expect(picturesProblem([new Uint8Array([1, 2, 3])])).toMatch(/not a png, jpg or webp/);

    const { db, t, draft } = await setup();
    const s = await draft("<p>v1</p>");
    const kept = new Map<string, Uint8Array>();
    const store = { put: async (k: string, b: Uint8Array) => void kept.set(k, b) };
    const { request } = await addSampleRequest(db, t, s.id, { text: "Use this photo of the grill", byName: "Olu", pictures: [jpg, png] }, store);
    expect([...kept.keys()]).toEqual([`samples/${s.id}/requests/${request.id}/1.jpg`, `samples/${s.id}/requests/${request.id}/2.png`]);
    for (const b of kept.values()) expect(Buffer.from(b).includes("SecretCam")).toBe(false);
    await expect(addSampleRequest(db, t, s.id, { text: "x", byName: "Olu", pictures: [png] }, null)).rejects.toThrow(/storage is not set up/);
    const view = requestView((await db.select().from(sampleRequests).where(eq(sampleRequests.id, request.id)))[0]);
    expect(view).toMatchObject({ text: "Use this photo of the grill", by: "Olu", madeOnVersion: 1, status: "open", answeredVersion: null, needsHelper: true, pictures: [{ n: 1, type: "image/jpeg" }, { n: 2, type: "image/png" }] });
    expect(JSON.stringify(view)).not.toContain("samples/"); // the bucket key never leaves
    const got = await requestPicture(db, t, s.id, request.id, 2, async (key) => kept.get(key) ?? null);
    expect(got?.type).toBe("image/png");
    expect(await requestPicture(db, t, s.id, request.id, 3, async () => null)).toBeNull();
    expect((await openRequestCounts(db, t, [s.id])).get(s.id)).toEqual({ open: 1, withPictures: 1 });
  });
});

describe("the Reference mark follows the approved version", () => {
  it("markable while a newer draft waits, pinned to the approved version, never to the draft's", async () => {
    const { db, t, draft, bump } = await setup();
    const s = await draft("<p>v1</p>");
    await expect(setReference(db, t, s.id, "Olu")).rejects.toThrow(/only an approved or live/);
    await reviewSample(db, t, s.id, "approve", { name: "Olu" });
    await bump("Mon-Sun 10-22");
    await draft("<p>v2</p>", [await askAsPerson(db, t, s.id)]);
    expect((await setReference(db, t, s.id, "Olu")).version).toBe(1);
    expect((await references(db, t)).references[0].version).toBe(1);
  });
});
