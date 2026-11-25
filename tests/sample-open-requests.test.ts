// A version that leaves a change request open stays with the builder
// and cannot be approved; the person who filed it, the owner or a manager can close or withdraw it first.
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb, type Db } from "@/lib/db";
import { sampleRequests, samples, tenants } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { canCloseRequest, openRequestsLine } from "@/lib/sample-labels";
import { closeRequest, recordRequest, requestsOf, reviewOf, reviewSample, sampleCards, sampleFooter, saveDraft, type SampleCard } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";

const NOMAP = async () => "";
const page = (b: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1><p>${b}</p>${sampleFooter("Gamma Grill", "")}</body></html>`;
const BOB = "11111111-1111-4111-8111-111111111111";
const EVE = "22222222-2222-4222-8222-222222222222";
const member = (userId: string) => ({ name: "Member", userId, role: "member" });
const OWNER = { name: "Olu", userId: "33333333-3333-4333-8333-333333333333", role: "owner" };
const MANAGER = { name: "Mina", userId: "44444444-4444-4444-8444-444444444444", role: "manager" };

let db: Db;
let t: string;
let lead: string;
const save = (b: string, answers?: string[]) => saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page(b), answers });
const ask = async (id: string, text: string, byUser: string | null = BOB) => (await recordRequest(db, t, id, { text, byName: "Bob", byUser })).request.id;
const statusOf = async (id: string) => (await db.select({ s: samples.status }).from(samples).where(eq(samples.id, id)))[0].s;

beforeEach(async () => {
  db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  t = tenant.id;
  const who: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const r = await writeLead(db, t, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, who, { create: true });
  if (!r.ok) throw new Error(r.message);
  lead = String(r.lead.id);
});

describe("a new version and the open requests (790)", () => {
  it("one that answers them all goes to draft, as today", async () => {
    const s = await save("v1");
    const a = await ask(s.id, "bigger logo");
    const b = await ask(s.id, "new photo");
    const v2 = await save("v2", [a, b]);
    expect(v2).toMatchObject({ status: "draft", version: 2 });
    expect([...v2.answered].sort()).toEqual([a, b].sort());
  });

  it("one with no answers list closes none and stays with the builder (800)", async () => {
    const s = await save("v1");
    await ask(s.id, "bigger logo");
    expect(await save("v2")).toMatchObject({ status: "changes_requested", answered: [] });
    expect(await requestsOf(db, t, s.id, "open")).toHaveLength(1);
  });

  it("one that answers some stays changes_requested, and says how many are open", async () => {
    const s = await save("v1");
    const a = await ask(s.id, "bigger logo");
    await ask(s.id, "new photo");
    const v2 = await save("v2", [a]);
    expect(v2).toMatchObject({ status: "changes_requested", version: 2 });
    expect(v2.answered).toEqual([a]);
    const [c] = (await sampleCards(db, t)).cards.filter((x) => x.id === s.id);
    expect(reviewOf(c)).toMatchObject({ group: "builder", why: "Version 2, 1 request still open" });
  });

  it("one that answers none stays changes_requested", async () => {
    const s = await save("v1");
    await ask(s.id, "a");
    await ask(s.id, "b");
    expect(await save("v2", [])).toMatchObject({ status: "changes_requested" });
    const [c] = (await sampleCards(db, t)).cards.filter((x) => x.id === s.id);
    expect(reviewOf(c).why).toBe(openRequestsLine(2, 2));
    expect(reviewOf(c).why).not.toMatch(/waits for you/);
  });

  it("Settings' auto-approve does not approve a version that leaves one open", async () => {
    const s = await save("v1");
    await db.update(tenants).set({ settings: { samplesAutoPublish: true } }).where(eq(tenants.id, t));
    await ask(s.id, "a");
    const v2 = await save("v2", []);
    expect(v2.status).toBe("changes_requested");
    expect(v2.approvedVersion).toBeNull();
  });

  it("the version on the web stays up while a newer one leaves a request open", async () => {
    const s = await save("v1");
    await reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null);
    const a = await ask(s.id, "a");
    await ask(s.id, "b");
    const v2 = await save("v2", [a]); // it names a person's request; the other stays open
    expect(v2).toMatchObject({ status: "changes_requested", version: 2, approvedVersion: 1 });
  });
});

describe("Approve with an open request (790)", () => {
  it("is refused on a version sent back, with the line", async () => {
    const s = await save("v1");
    await ask(s.id, "a");
    await save("v2", []);
    await expect(reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null)).rejects.toThrow(/^Version 2, 1 request still open\. Nothing was approved/);
    expect(await statusOf(s.id)).toBe("changes_requested");
  });

  it("is refused on a draft that holds one, however it got there", async () => {
    const s = await save("v1");
    await ask(s.id, "a");
    await db.update(samples).set({ status: "draft" }).where(eq(samples.id, s.id));
    await expect(reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null)).rejects.toThrow(/1 request still open/);
    expect(await statusOf(s.id)).toBe("draft");
  });

  it("passes with none open", async () => {
    const s = await save("v1");
    const a = await ask(s.id, "a");
    await save("v2", [a]);
    expect(await reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null)).toMatchObject({ status: "approved", approvedVersion: 2 });
  });
});

describe("closing a request (790)", () => {
  it("the filer, the owner or a manager; not another member", async () => {
    const s = await save("v1");
    const a = await ask(s.id, "a");
    await expect(closeRequest(db, t, s.id, a, "withdraw", member(EVE))).rejects.toMatchObject({ status: 403 });
    expect((await requestsOf(db, t, s.id, "open")).length).toBe(1);
    expect(canCloseRequest(member(BOB), { byUser: BOB })).toBe(true);
    expect(canCloseRequest(member(EVE), { byUser: BOB })).toBe(false);
    expect(canCloseRequest(member(EVE), { byUser: null })).toBe(false);
    expect(canCloseRequest(OWNER, { byUser: BOB })).toBe(true);
    expect(canCloseRequest(MANAGER, { byUser: null })).toBe(true);
    expect(await closeRequest(db, t, s.id, a, "withdraw", member(BOB))).toEqual({ left: 0, status: "draft" });
  });

  it("the last one closed puts the version back in front of a person, and Approve then works", async () => {
    const s = await save("v1");
    const a = await ask(s.id, "a");
    const b = await ask(s.id, "b");
    await save("v2", []);
    expect(await closeRequest(db, t, s.id, a, "done", OWNER)).toEqual({ left: 1, status: "changes_requested" });
    await expect(reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null)).rejects.toThrow(/1 request still open/);
    expect(await closeRequest(db, t, s.id, b, "withdraw", MANAGER)).toEqual({ left: 0, status: "draft" });
    const [ra] = await db.select().from(sampleRequests).where(eq(sampleRequests.id, a));
    const [rb] = await db.select().from(sampleRequests).where(eq(sampleRequests.id, b));
    expect(ra).toMatchObject({ status: "answered", answeredVersion: 2 });
    expect(rb.status).toBe("withdrawn");
    expect(await reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null)).toMatchObject({ status: "approved", approvedVersion: 2 });
  });

  it("closing one never approves or publishes, and an approved page leaves the builder's list", async () => {
    const s = await save("v1");
    await reviewSample(db, t, s.id, "approve", { name: "Olu" }, "", null);
    const a = await ask(s.id, "a");
    expect((await db.select({ n: samples.changesNote }).from(samples).where(eq(samples.id, s.id)))[0].n).toBe("a");
    expect(await closeRequest(db, t, s.id, a, "withdraw", OWNER)).toEqual({ left: 0, status: "approved" });
    expect((await db.select({ n: samples.changesNote }).from(samples).where(eq(samples.id, s.id)))[0].n).toBe("");
  });

  it("refuses a closed request, a dead sample, and another company's", async () => {
    const s = await save("v1");
    const a = await ask(s.id, "a");
    await closeRequest(db, t, s.id, a, "done", OWNER);
    await expect(closeRequest(db, t, s.id, a, "withdraw", OWNER)).rejects.toMatchObject({ status: 409 });
    const b = await ask(s.id, "b");
    const { tenant: other } = await createTenant(db, "Other", "other", { email: "o@other.example", name: "Ola" });
    await expect(closeRequest(db, other.id, s.id, b, "done", OWNER)).rejects.toMatchObject({ status: 404 });
    await db.update(samples).set({ status: "taken_down" }).where(and(eq(samples.id, s.id), eq(samples.tenantId, t)));
    await expect(closeRequest(db, t, s.id, b, "done", OWNER)).rejects.toMatchObject({ status: 409 });
  });
});

describe("the line (790)", () => {
  it("counts in words", () => {
    expect(openRequestsLine(4, 1)).toBe("Version 4, 1 request still open");
    expect(openRequestsLine(4, 5)).toBe("Version 4, 5 requests still open");
  });
  it("a draft with none open still waits for a person", () => {
    const c = { status: "draft", version: 3, approvedVersion: null, url: "", requests: [], guestPhotos: [], note: "" } as unknown as SampleCard;
    expect(reviewOf(c)).toMatchObject({ group: "needs", why: "Version 3 waits for you" });
  });
});
