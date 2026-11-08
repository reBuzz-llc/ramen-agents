// An agent's review of a package draft: The CEO approves or asks to revise the Package Designer's
// draft before the owner prices and publishes. Only the newest agent's draft of that name, never a person's draft or a
// published package; a masked note only; a new handover clears the review.
import { describe, expect, it } from "vitest";
import { addDraft, checkReview, listPackages, packageJson, reviewDraft } from "@/lib/assets";
import { memoryDb } from "@/lib/db";
import { assetPackages } from "@/lib/db/schema";
import { createTenant } from "@/lib/tenants";

const draft = (name: string) => ({ name, price: "", offer: "", buyer: "Small shops", deliverables: ["A one-page site"], why: "", sources: [] });

describe("checkReview", () => {
  it("takes approve or revise with a short masked note; the agent from by, else the key", () => {
    expect(checkReview({ name: "Starter Website", verdict: "approve" }, "ceo-key")).toEqual({ ok: true, review: { name: "Starter Website", verdict: "approve", note: "", by: "ceo-key" } });
    expect(checkReview({ name: "Starter Website", verdict: "revise", note: "price  is\nmissing", by: "The CEO" }, "k")).toEqual({ ok: true, review: { name: "Starter Website", verdict: "revise", note: "price is missing", by: "The CEO" } });
    expect(checkReview({ name: "x", verdict: "maybe" }, "k")).toEqual({ ok: false, message: "verdict must be approve or revise" });
    expect(checkReview({ name: "x", verdict: "revise", note: "see https://rival.example/pricing" }, "k")).toMatchObject({ ok: false, message: expect.stringMatching(/a web address/) });
    expect(checkReview({ name: "x", verdict: "revise", note: "y".repeat(501) }, "k")).toMatchObject({ ok: false });
    expect(checkReview({ verdict: "approve" }, "k")).toMatchObject({ ok: false });
  });
});

describe("reviewDraft", () => {
  it("stamps the newest agent's draft; never a person's draft or a published package; a new handover clears it", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    // a published package and a person's draft with the same name, and two agents' drafts
    await db.insert(assetPackages).values([
      { tenantId: tenant.id, position: 1, name: "Starter Website", status: "published", updatedBy: "Olu" },
      { tenantId: tenant.id, position: 2, name: "Menu Online", status: "draft", updatedBy: "Olu" },
    ]);
    const older = await addDraft(db, tenant.id, draft("Starter Website"), "Scout");
    await new Promise((r) => setTimeout(r, 5));
    const newer = await addDraft(db, tenant.id, draft("starter website"), "Package Designer");

    const at = new Date("2026-11-09T10:00:00Z");
    const r = await reviewDraft(db, tenant.id, { name: "Starter Website", verdict: "revise", note: "the price is missing", by: "The CEO" }, at);
    expect(r).toEqual({ id: newer.id, reviewedAt: at.toISOString() });
    const all = await listPackages(db, tenant.id);
    const byId = new Map(all.map((p) => [p.id, p]));
    expect(byId.get(newer.id)).toMatchObject({ reviewedBy: "The CEO", reviewVerdict: "revise", reviewNote: "the price is missing", reviewedAt: at.toISOString() });
    expect(byId.get(older.id)?.reviewedBy).toBeNull();
    expect(all.filter((p) => p.status === "published" || !p.handedOverBy).every((p) => p.reviewedBy === null)).toBe(true);
    expect(packageJson(byId.get(newer.id)!)).toMatchObject({ reviewed_by: "The CEO", review_verdict: "revise", review_note: "the price is missing" });

    // only a person's draft of that name: nothing to review
    expect(await reviewDraft(db, tenant.id, { name: "Menu Online", verdict: "approve", note: "", by: "The CEO" })).toBeNull();
    expect(await reviewDraft(db, tenant.id, { name: "Nothing Like It", verdict: "approve", note: "", by: "The CEO" })).toBeNull();

    // the Designer hands it over again: a new text, so the old review goes
    await addDraft(db, tenant.id, { ...draft("Starter Website"), price: "$990" }, "Package Designer");
    expect((await listPackages(db, tenant.id)).find((p) => p.id === newer.id)).toMatchObject({ reviewedBy: null, reviewVerdict: null, reviewNote: null });
  });
});
