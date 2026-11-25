// The engine may give a live sample a new version only on a person's
// request, so Peek says reliably who filed one. `byPerson` comes only from a signed-in session; a key can write any name in `by`
// and still never makes one. Invented people and businesses.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST as review } from "@/app/api/samples/[id]/route";
import { POST as fileRequest } from "@/app/api/samples/[id]/requests/route";
import { POST as note } from "@/app/v1/samples/[id]/note/route";
import { GET as listRequests } from "@/app/v1/samples/[id]/requests/route";
import { mintKey } from "@/lib/api-keys";
import { memoryDb, type Db } from "@/lib/db";
import { sampleRequests } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { recordRequest, reviewSample, sampleFooter, saveDraft } from "@/lib/samples";
import { addUser, createTenant } from "@/lib/tenants";

const h = vi.hoisted(() => ({ db: null as unknown, who: null as unknown }));
vi.mock("@/lib/db", async (real) => ({ ...(await real<typeof import("@/lib/db")>()), db: async () => h.db }));
vi.mock("@/lib/auth", () => ({ me: async () => h.who, sessionHint: async () => null }));

const page = `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1><p>v1</p>${sampleFooter("Gamma Grill", "")}</body></html>`;
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const site = { origin: "http://peek.test", host: "peek.test" };

let db: Db;
let t: string;
let sid: string;
let token: string;
let ownerId: string;
let memberId: string;
const person = (userId: string, role: string, name: string) => ({ userId, tenantId: t, role, name, email: `${name.toLowerCase()}@acme.example`, acked: true });
const asked = async () => (await (await listRequests(new Request(`http://peek.test/v1/samples/${sid}/requests`, { headers: { authorization: `Bearer ${token}` } }), ctx(sid))).json()).requests as Record<string, unknown>[];
const byText = async (text: string) => (await asked()).find((r) => r.text === text)!;
const keyNote = (body: object) => note(new Request(`http://peek.test/v1/samples/${sid}/note`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }), ctx(sid));
const pressChanges = (text: string) => review(new Request(`http://peek.test/api/samples/${sid}`, { method: "POST", headers: { ...site, "content-type": "application/json" }, body: JSON.stringify({ action: "changes", note: text }) }), ctx(sid));

beforeEach(async () => {
  db = await memoryDb();
  h.db = db;
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  t = tenant.id;
  ownerId = owner.id;
  memberId = (await addUser(db, t, "mia@acme.example", "Mia")).id;
  const who: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const r = await writeLead(db, t, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", package: "Starter Website" }, who, { create: true });
  if (!r.ok) throw new Error(r.message);
  sid = (await saveDraft(db, t, String(r.lead.id), "eat", undefined, "Site Builder", async () => "", { html: page })).id;
  await reviewSample(db, t, sid, "approve", { name: "Olu" });
  token = (await mintKey(db, t, "engine", ["board:read", "board:write"])).token;
});

describe("who filed a change request (811)", () => {
  it("a key's request is never a person's, whatever name or field it sends", async () => {
    expect((await keyNote({ note: "from a key", by: "Olu", byUser: ownerId, by_user: ownerId, byPerson: true })).status).toBe(200);
    expect(await byText("from a key")).toMatchObject({ by: "Olu", byPerson: false });
    expect((await db.select({ u: sampleRequests.byUser }).from(sampleRequests))[0].u).toBeNull();
  });

  it("the dashboard's Decisions answer is not a person's: it arrives with the engine's key", async () => {
    await keyNote({ note: "decisions box answer", by: "Owner (dashboard)" });
    expect(await byText("decisions box answer")).toMatchObject({ by: "Owner (dashboard)", byPerson: false });
  });

  it("Request changes by a signed-in owner and a signed-in member is a person's", async () => {
    h.who = person(ownerId, "owner", "Olu");
    expect((await pressChanges("owner asks")).status).toBe(200);
    h.who = person(memberId, "member", "Mia");
    expect((await pressChanges("member asks")).status).toBe(200);
    expect(await byText("owner asks")).toMatchObject({ byPerson: true });
    expect(await byText("member asks")).toMatchObject({ byPerson: true });
    const stored = await db.select({ text: sampleRequests.text, u: sampleRequests.byUser }).from(sampleRequests);
    expect(Object.fromEntries(stored.map((r) => [r.text, r.u]))).toEqual({ "owner asks": ownerId, "member asks": memberId });
  });

  it("takes the person from the session, never from the body", async () => {
    h.who = person(memberId, "member", "Mia");
    await review(new Request(`http://peek.test/api/samples/${sid}`, { method: "POST", headers: { ...site, "content-type": "application/json" }, body: JSON.stringify({ action: "changes", note: "body names the owner", userId: ownerId, byUser: ownerId }) }), ctx(sid));
    expect((await db.select({ u: sampleRequests.byUser }).from(sampleRequests))[0].u).toBe(memberId);
  });

  it("the request form with pictures is a person's too", async () => {
    h.who = person(memberId, "member", "Mia");
    const form = new FormData();
    form.set("text", "from the form");
    const res = await fileRequest(new Request(`http://peek.test/api/samples/${sid}/requests`, { method: "POST", headers: site, body: form }), ctx(sid));
    expect(res.status).toBe(200);
    expect(await byText("from the form")).toMatchObject({ byPerson: true });
  });

  it("a request with no stored person stays false, and the person's id is never sent", async () => {
    await recordRequest(db, t, sid, { text: "an old request", byName: "Olu" });
    await recordRequest(db, t, sid, { text: "a stored person", byName: "Olu", byUser: ownerId });
    expect(await byText("an old request")).toMatchObject({ byPerson: false });
    expect(await byText("a stored person")).toMatchObject({ byPerson: true });
    expect(JSON.stringify(await asked())).not.toContain(ownerId);
  });

  it("a signed-out press files nothing", async () => {
    h.who = null;
    expect((await pressChanges("nobody")).status).toBe(401);
    expect(await asked()).toEqual([]);
  });
});
