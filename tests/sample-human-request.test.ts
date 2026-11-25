// An approved, live site is not updated without a person's request: a sample on the web takes
// a new version only for a signed-in person's open request, named in `answers`, and the new version never goes public without a
// person's Approve. Invented businesses.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as review } from "@/app/api/samples/[id]/route";
import { POST as drafts } from "@/app/v1/samples/drafts/route";
import { POST as note } from "@/app/v1/samples/[id]/note/route";
import { mintKey } from "@/lib/api-keys";
import { memoryDb, type Db } from "@/lib/db";
import { samples, tenants } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { HUMAN_REQUEST_ONLY, publishQueue, recordRequest, reportPublish, requestsOf, rerenderFacts, reviewSample, sampleFooter, saveDraft } from "@/lib/samples";
import { addUser, createTenant } from "@/lib/tenants";

const h = vi.hoisted(() => ({ db: null as unknown, who: null as unknown }));
vi.mock("@/lib/db", async (real) => ({ ...(await real<typeof import("@/lib/db")>()), db: async () => h.db }));
vi.mock("@/lib/auth", () => ({ me: async () => h.who, sessionHint: async () => null }));

const NOMAP = async () => "";
const page = (b: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1><p>${b}</p>${sampleFooter("Gamma Grill", "")}</body></html>`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

let db: Db;
let t: string;
let lead: string;
let sid: string;
let token: string;
let ownerId: string;
let memberId: string;
const save = (b: string, extra: { answers?: unknown; notComplete?: string } = {}, by = "Site Builder") => saveDraft(db, t, lead, "eat", undefined, by, NOMAP, { html: page(b), ...extra });
const statusRow = async () => (await db.select().from(samples).where(eq(samples.id, sid)))[0];
const person = (userId: string, role: string, name: string) => ({ userId, tenantId: t, role, name, email: `${name.toLowerCase()}@acme.example`, acked: true });
const press = (text: string) => review(new Request(`http://peek.test/api/samples/${sid}`, { method: "POST", headers: { origin: "http://peek.test", host: "peek.test", "content-type": "application/json" }, body: JSON.stringify({ action: "changes", note: text }) }), ctx(sid));
const openId = async (text: string) => (await requestsOf(db, t, sid, "open")).find((r) => r.text === text)!.id;

beforeEach(async () => {
  db = await memoryDb();
  h.db = db;
  const made = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  t = made.tenant.id;
  ownerId = made.owner.id;
  memberId = (await addUser(db, t, "mia@acme.example", "Mia")).id;
  const who: Actor = { kind: "person", name: "Olu", userId: ownerId };
  const r = await writeLead(db, t, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", package: "Starter Website" }, who, { create: true });
  if (!r.ok) throw new Error(r.message);
  lead = String(r.lead.id);
  const first = await save("v1");
  sid = first.id;
  await reviewSample(db, t, sid, "approve", { name: "Olu" });
  await reportPublish(db, t, sid, "published", `https://x.pages.dev/${first.slug}/`);
  token = (await mintKey(db, t, "engine", ["board:read", "board:write"])).token;
});

describe("a sample on the web (829)", () => {
  it("refuses a new version with no request, from the builder and from the site helper's tool, over the API too", async () => {
    await expect(save("v2")).rejects.toThrow(HUMAN_REQUEST_ONLY);
    await expect(save("v2", { answers: [] }, "site helper")).rejects.toThrow(HUMAN_REQUEST_ONLY);
    const res = await drafts(new Request("http://peek.test/v1/samples/drafts", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ leadId: lead, html: page("v2"), by: "site helper" }) }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.message).toBe(HUMAN_REQUEST_ONLY);
    expect(await statusRow()).toMatchObject({ status: "live", version: 1 });
  });

  it("is not opened by a key's request, even under a person's name", async () => {
    await note(new Request(`http://peek.test/v1/samples/${sid}/note`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ note: "from a key", by: "Olu" }) }), ctx(sid));
    await expect(save("v2", { answers: [await openId("from a key")] })).rejects.toThrow(HUMAN_REQUEST_ONLY);
    expect((await statusRow()).version).toBe(1);
  });

  it.each([["owner", () => person(ownerId, "owner", "Olu")], ["member", () => person(memberId, "member", "Mia")]])("is opened by a signed-in %s's request, when the version names it", async (_who, who) => {
    h.who = who();
    expect((await press("Bigger logo")).status).toBe(200);
    const id = await openId("Bigger logo");
    await expect(save("v2")).rejects.toThrow(HUMAN_REQUEST_ONLY);
    await expect(save("v2", { answers: [] })).rejects.toThrow(HUMAN_REQUEST_ONLY);
    const v2 = await save("v2", { answers: [id] });
    expect(v2).toMatchObject({ version: 2, status: "draft", approvedVersion: 1, answered: [id] });
  });

  it("keeps the live version up until a person approves the new one, with Settings' auto-approve on", async () => {
    await db.update(tenants).set({ settings: { samplesAutoPublish: true } }).where(eq(tenants.id, t));
    const id = (await recordRequest(db, t, sid, { text: "New hours", byName: "Olu", byUser: ownerId })).request.id;
    const v2 = await save("v2 words", { answers: [id] });
    expect(v2).toMatchObject({ status: "draft", approvedVersion: 1 });
    const served = (await publishQueue(db, t)).find((x) => x.id === sid);
    expect(served).toMatchObject({ version: 1 });
    expect(served?.html).not.toContain("v2 words");
  });

  it("takes an incomplete version for a person's open request, closing nothing; without one it is refused", async () => {
    await expect(save("half", { notComplete: "the gallery was refused" })).rejects.toThrow(HUMAN_REQUEST_ONLY);
    const id = (await recordRequest(db, t, sid, { text: "Add a gallery", byName: "Olu", byUser: ownerId })).request.id;
    expect(await save("half", { notComplete: "the gallery was refused" })).toMatchObject({ status: "changes_requested", version: 2, answered: [], approvedVersion: 1 });
    expect((await requestsOf(db, t, sid, "open")).map((r) => r.id)).toEqual([id]);
  });

  it("still applies while a newer version waits, once its request is answered", async () => {
    const id = (await recordRequest(db, t, sid, { text: "One change", byName: "Olu", byUser: ownerId })).request.id;
    await save("v2", { answers: [id] });
    await expect(save("v3")).rejects.toThrow(HUMAN_REQUEST_ONLY);
  });

  it("is not re-rendered by a facts change", async () => {
    await db.update(samples).set({ kind: "template", factsHash: "old" }).where(eq(samples.id, sid));
    expect(await rerenderFacts(db, t, lead, NOMAP)).toBeNull();
    expect((await statusRow()).version).toBe(1);
  });
});

describe("a sample never approved (829)", () => {
  it("is unaffected: a builder replaces its own draft and a sent-back one", async () => {
    const r = await writeLead(db, t, {}, { business: "Delta Deli", industry: "Restaurant", location: "Astoria, NY", package: "Starter Website" }, { kind: "person", name: "Olu", userId: ownerId }, { create: true });
    if (!r.ok) throw new Error(r.message);
    const other = String(r.lead.id);
    const delta = (b: string) => `<!doctype html><html lang="en"><head><title>D</title></head><body><h1>Delta Deli</h1><p>${b}</p>${sampleFooter("Delta Deli", "")}</body></html>`;
    const one = await saveDraft(db, t, other, "eat", undefined, "Site Builder", NOMAP, { html: delta("v1") });
    expect(await saveDraft(db, t, other, "eat", undefined, "Site Builder", NOMAP, { html: delta("v2") })).toMatchObject({ id: one.id, version: 2, status: "draft" });
  });
});
