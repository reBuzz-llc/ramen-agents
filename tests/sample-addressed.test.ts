// A Site Builder round only claims a request. A person's Approve or Done confirms it, Not done
// sends it back, and a key can send one back but never confirm one, nor reopen one on a sample with an approved version.
import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb, type Db } from "@/lib/db";
import { sampleRequests, samples } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { requestState } from "@/lib/sample-labels";
import { closeRequest, openRequestCount, recordRequest, reopenRequest, reviewSample, sampleFooter, saveDraft } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";

const NOMAP = async () => "";
const page = (b: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1><p>${b}</p>${sampleFooter("Gamma Grill", "")}</body></html>`;
const BOB = "11111111-1111-4111-8111-111111111111";
const OWNER = { name: "Olu", userId: "33333333-3333-4333-8333-333333333333", role: "owner" };
const STRANGER = { name: "Mia", userId: "22222222-2222-4222-8222-222222222222", role: "member" };

let db: Db;
let t: string;
let lead: string;
const save = (b: string, answers?: string[]) => saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page(b), answers });
const ask = async (id: string, text: string) => (await recordRequest(db, t, id, { text, byName: "Bob", byUser: BOB })).request.id;
const req = async (id: string) => (await db.select().from(sampleRequests).where(eq(sampleRequests.id, id)))[0];
const row = async (id: string) => (await db.select().from(samples).where(eq(samples.id, id)))[0];
async function claimed() {
  const s = await save("v1");
  const a = await ask(s.id, "bigger logo");
  const v2 = await save("v2", [a]);
  return { id: s.id, a, v2 };
}

beforeEach(async () => {
  db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  t = tenant.id;
  const who: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const r = await writeLead(db, t, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, who, { create: true });
  if (!r.ok) throw new Error(r.message);
  lead = String(r.lead.id);
});

describe("a round's claim", () => {
  it("makes the request addressed, keeps its version and still counts the draft as ready", async () => {
    const { id, a, v2 } = await claimed();
    expect(v2).toMatchObject({ status: "draft", version: 2, answered: [a] });
    expect(await req(a)).toMatchObject({ status: "addressed", answeredVersion: 2 });
    expect((await req(a)).answeredAt).toBeTruthy();
    expect(await openRequestCount(db, t, id)).toBe(0);
  });

  it("reads as claimed on the card", () => {
    expect(requestState({ status: "addressed", answeredVersion: 4, pictures: [], at: "" }, "Site Builder")).toBe("Claimed done in version 4, to check");
  });
});

describe("a person's word", () => {
  it("Approve confirms what was claimed, with no extra click", async () => {
    const { id, a } = await claimed();
    await reviewSample(db, t, id, "approve", { name: "Olu", userId: OWNER.userId }, "", null);
    expect(await req(a)).toMatchObject({ status: "answered", answeredVersion: 2 });
  });

  it("an Approve with no person behind it confirms nothing", async () => {
    const { id, a } = await claimed();
    await reviewSample(db, t, id, "approve", { name: "Auto" }, "", null);
    expect((await req(a)).status).toBe("addressed");
  });

  it("an Approve that does not land confirms nothing", async () => {
    const { id, a } = await claimed();
    await expect(reviewSample(db, t, id, "approve", { name: "Olu", userId: OWNER.userId }, "", null, 1)).rejects.toThrow(/newer version/);
    expect((await req(a)).status).toBe("addressed");
  });

  it("Done confirms it and keeps the version that claimed it", async () => {
    const { id, a } = await claimed();
    await save("v3");
    await closeRequest(db, t, id, a, "done", OWNER);
    expect(await req(a)).toMatchObject({ status: "answered", answeredVersion: 2 });
  });

  it("Done stays with the filer, the owner or a manager; Withdraw is for open requests", async () => {
    const { id, a } = await claimed();
    await expect(closeRequest(db, t, id, a, "done", STRANGER)).rejects.toMatchObject({ status: 403 });
    await expect(closeRequest(db, t, id, a, "withdraw", OWNER)).rejects.toMatchObject({ status: 409 });
    expect((await req(a)).status).toBe("addressed");
  });

  it("Not done sends it back to open, clears the claim and returns the draft to the builder", async () => {
    const { id, a } = await claimed();
    expect(await reopenRequest(db, t, id, a, { name: "Mia" })).toEqual({ open: 1, status: "changes_requested" });
    expect(await req(a)).toMatchObject({ status: "open", answeredVersion: null, answeredAt: null });
    expect(await row(id)).toMatchObject({ status: "changes_requested", note: "bigger logo", reviewedBy: "Mia" });
    await expect(reviewSample(db, t, id, "approve", { name: "Olu", userId: OWNER.userId }, "", null)).rejects.toThrow();
  });

  it("the next round can claim it again", async () => {
    const { id, a } = await claimed();
    await reopenRequest(db, t, id, a, { name: "Mia" });
    expect(await save("v3", [a])).toMatchObject({ status: "draft", version: 3 });
    expect(await req(a)).toMatchObject({ status: "addressed", answeredVersion: 3 });
    expect((await row(id)).status).toBe("draft");
  });

  it("a person may send one back on a live sample: the page stays up and the request waits for a next version", async () => {
    const { id, a } = await claimed();
    await db.update(samples).set({ status: "live", approvedVersion: 2, url: "https://x.pages.dev/g/" }).where(eq(samples.id, id));
    expect(await reopenRequest(db, t, id, a, { name: "Olu" })).toEqual({ open: 1, status: "live" });
    expect(await row(id)).toMatchObject({ status: "live", approvedVersion: 2, changesNote: "bigger logo" });
  });

  it("only a claimed request can be sent back", async () => {
    const { id, a } = await claimed();
    await closeRequest(db, t, id, a, "done", OWNER);
    await expect(reopenRequest(db, t, id, a, { name: "Olu" })).rejects.toMatchObject({ status: 409 });
    const open = await ask(id, "another thing");
    await expect(reopenRequest(db, t, id, open, { name: "Olu" })).rejects.toMatchObject({ status: 409 });
  });
});

describe("a key", () => {
  it("can send a claimed request back on a draft", async () => {
    const { id, a } = await claimed();
    expect(await reopenRequest(db, t, id, a, null)).toEqual({ open: 1, status: "changes_requested" });
    expect((await row(id)).reviewedBy).not.toBe("Olu");
  });

  it.each(["approved", "live", "draft"] as const)("cannot on a sample with an approved version (%s): that would pass for a person's yes", async (status) => {
    const { id, a } = await claimed();
    await db.update(samples).set({ status, approvedVersion: 1 }).where(eq(samples.id, id));
    await expect(reopenRequest(db, t, id, a, null)).rejects.toMatchObject({ status: 403 });
    expect((await req(a)).status).toBe("addressed");
  });

  it("has no route that confirms one", async () => {
    const { readFileSync } = await import("node:fs");
    const route = readFileSync("app/v1/samples/[id]/requests/[rid]/route.ts", "utf8");
    expect(route).toContain('b?.action !== "reopen"');
    expect(route).not.toContain("closeRequest");
  });
});
