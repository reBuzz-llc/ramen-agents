// A version the engine marks `notComplete` closes no request,
// stays with the builder and cannot be approved by anyone until a later version comes without the mark. And a newer version alone
// closes nothing: only the ids it names in `answers` do. Invented businesses.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/v1/samples/drafts/route";
import { mintKey } from "@/lib/api-keys";
import { memoryDb, type Db } from "@/lib/db";
import { sampleVersions, samples } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { notCompleteLine, notCompleteReason } from "@/lib/sample-labels";
import { closeRequest, publishQueue, recordRequest, reportPublish, requestsOf, reviewOf, reviewSample, sampleCards, sampleFooter, saveDraft, undoTakedown } from "@/lib/samples";
import { createTenant, updateSettings } from "@/lib/tenants";
import { askAsPerson } from "./helpers/person-request";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async (real) => ({ ...(await real<typeof import("@/lib/db")>()), db: async () => h.db }));

const NOMAP = async () => "";
const WHY = "the gallery page was refused: it says something the facts do not hold";
const OWNER = { name: "Olu", userId: "33333333-3333-4333-8333-333333333333", role: "owner" };
const page = (b: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1><p>${b}</p>${sampleFooter("Gamma Grill", "")}</body></html>`;

let db: Db;
let t: string;
let lead: string;
const save = (b: string, extra: { answers?: unknown; notComplete?: unknown } = {}) => saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page(b), ...extra });
const ask = async (id: string, text: string) => (await recordRequest(db, t, id, { text, byName: "Bob" })).request.id;
const card = async (id: string) => (await sampleCards(db, t)).cards.find((c) => c.id === id)!;

beforeEach(async () => {
  db = await memoryDb();
  h.db = db;
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  t = tenant.id;
  const who: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const r = await writeLead(db, t, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, who, { create: true });
  if (!r.ok) throw new Error(r.message);
  lead = String(r.lead.id);
});

describe("a version marked not complete (800)", () => {
  it("closes no request even when its list names one, stays changes_requested and shows the reason", async () => {
    const s = await save("v1");
    const a = await ask(s.id, "add the gallery");
    const v2 = await save("v2", { answers: [a], notComplete: WHY });
    expect(v2).toMatchObject({ status: "changes_requested", version: 2, notComplete: WHY, answered: [] });
    expect((await requestsOf(db, t, s.id, "open")).map((r) => r.id)).toEqual([a]);
    const c = await card(s.id);
    expect(c.notComplete).toBe(WHY);
    expect(reviewOf(c)).toMatchObject({ group: "builder", why: notCompleteLine(2, WHY) });
  });

  it("refuses Approve with the reason, for the owner and a member alike", async () => {
    const s = await save("v1");
    await save("v2", { notComplete: WHY });
    for (const name of ["Olu", "A member"]) await expect(reviewSample(db, t, s.id, "approve", { name })).rejects.toThrow(WHY);
    expect((await db.select({ s: samples.status }).from(samples).where(eq(samples.id, s.id)))[0].s).toBe("changes_requested");
  });

  it("stays unapprovable after every request is closed, and the builder still reads the reason", async () => {
    const s = await save("v1");
    const a = await ask(s.id, "add the gallery");
    await save("v2", { answers: [a], notComplete: WHY });
    expect(await closeRequest(db, t, s.id, a, "withdraw", OWNER)).toMatchObject({ left: 0, status: "changes_requested" });
    const [row] = await db.select({ note: samples.note }).from(samples).where(eq(samples.id, s.id));
    expect(row.note).toBe(WHY);
    await expect(reviewSample(db, t, s.id, "approve", { name: "Olu" })).rejects.toThrow(WHY);
  });

  it("is never approved by Settings, on a first version or a later one", async () => {
    await updateSettings(db, t, () => ({ samplesAutoPublish: true }));
    const first = await save("v1", { notComplete: WHY });
    expect(first).toMatchObject({ status: "changes_requested", version: 1, notComplete: WHY, note: WHY });
    expect(first.approvedVersion).toBeNull();
    const second = await save("v2", { notComplete: WHY });
    expect(second).toMatchObject({ status: "changes_requested", version: 2 });
    expect(second.approvedVersion).toBeNull();
  });

  it("is cleared by a later version without the mark, which then answers and can be approved", async () => {
    const s = await save("v1");
    const a = await ask(s.id, "add the gallery");
    await save("v2", { answers: [a], notComplete: WHY });
    const v3 = await save("v3", { answers: [a] });
    expect(v3).toMatchObject({ status: "draft", version: 3, notComplete: "", note: "add the gallery", answered: [a] });
    expect((await reviewSample(db, t, s.id, "approve", { name: "Olu" })).status).toBe("approved");
  });

  it("keeps the approved version on the web, and its own reason in the version history", async () => {
    const s = await save("v1");
    await reviewSample(db, t, s.id, "approve", { name: "Olu" });
    const asked = await askAsPerson(db, t, s.id);
    const v2 = await save("v2 half done", { notComplete: WHY });
    expect(v2).toMatchObject({ status: "changes_requested", approvedVersion: 1 });
    const served = (await publishQueue(db, t)).find((x) => x.id === s.id);
    expect(served).toMatchObject({ status: "approved", version: 1 });
    expect(served?.html).not.toContain("half done");
    await save("v3", { answers: [asked] });
    const [kept] = await db.select({ why: sampleVersions.notComplete }).from(sampleVersions).where(eq(sampleVersions.version, 2));
    expect(kept.why).toBe(WHY);
  });

  it("comes back from an undone take-down still with the builder", async () => {
    const s = await save("v1");
    await reviewSample(db, t, s.id, "approve", { name: "Olu" });
    await reportPublish(db, t, s.id, "published", `https://x.pages.dev/${s.slug}/`);
    await askAsPerson(db, t, s.id);
    await save("v2", { notComplete: WHY });
    await reviewSample(db, t, s.id, "takedown", { name: "Olu" });
    await reportPublish(db, t, s.id, "unpublished", "");
    expect(await undoTakedown(db, t, s.id, { name: "Olu" })).toMatchObject({ status: "changes_requested", version: 2, notComplete: WHY });
  });
});

describe("a newer version alone closes nothing (800)", () => {
  it("leaves every request open when `answers` is missing", async () => {
    const s = await save("v1");
    await ask(s.id, "bigger logo");
    expect(await save("v2")).toMatchObject({ status: "changes_requested", answered: [] });
    expect(await requestsOf(db, t, s.id, "open")).toHaveLength(1);
  });

  it("closes exactly the requests a version names", async () => {
    const s = await save("v1");
    const a = await ask(s.id, "bigger logo");
    const b = await ask(s.id, "new photo");
    expect(await save("v2", { answers: [a] })).toMatchObject({ status: "changes_requested", answered: [a] });
    expect((await requestsOf(db, t, s.id, "open")).map((r) => r.id)).toEqual([b]);
  });
});

describe("POST /v1/samples/drafts with notComplete (800)", () => {
  const post = async (body: object, token: string) => POST(new Request("http://peek.test/v1/samples/drafts", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) }));

  it("reads a reason as one line of 1 to 300 characters", () => {
    expect(notCompleteReason(`  two\n words `)).toBe("two words");
    expect(notCompleteReason("x".repeat(300))).toHaveLength(300);
    for (const bad of ["", "   ", "x".repeat(301), 7, null, ["a"], {}]) expect(notCompleteReason(bad)).toBe("");
  });

  it("takes a good reason, refuses a bad one and one without a page, and answers with the mark", async () => {
    const { token } = await mintKey(db, t, "engine", ["board:read", "board:write"]);
    for (const notComplete of ["", "   ", "x".repeat(301), 7, null]) expect((await post({ leadId: lead, html: page("v1"), notComplete }, token)).status).toBe(400);
    expect((await post({ leadId: lead, copy: { headline: "x" }, notComplete: WHY }, token)).status).toBe(400);
    expect(await db.select({ id: samples.id }).from(samples)).toEqual([]);
    const ok = await post({ leadId: lead, html: page("v1"), notComplete: WHY }, token);
    expect(ok.status).toBe(201);
    expect((await ok.json()).sample).toMatchObject({ status: "changes_requested", answered: [], notComplete: WHY });
  });
});
