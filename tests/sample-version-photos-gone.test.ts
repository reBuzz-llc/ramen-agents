// Photos were removed from Peek's files, and the old versions stay as records. A version says how many of the photos
// it shows are gone, and Undo take down refuses to bring back a page with a picture missing. Invented business and files.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { samples } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { reviewSample, sampleFooter, sampleVersionsOf, saveDraft, undoTakedown } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";

const page = (b: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1>${b}${sampleFooter("Gamma Grill", "")}</body></html>`;
const photo = (id: string, name: string) => ({ name, key: `samples/${id}/photos/${name}`, type: "image/webp", bytes: 1, guest: false, dish: "", at: "2026-11-20T00:00:00.000Z", by: "x", checks: ["a", "b", "c", "d"] });

describe("a version whose photos were removed", () => {
  it("says how many, and cannot come back from a take-down as it was", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const who: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const r = await writeLead(db, tenant.id, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", package: "Starter Website" }, who, { create: true });
    if (!r.ok) throw new Error(r.message);
    const s = await saveDraft(db, tenant.id, String(r.lead.id), "eat", undefined, "Site Builder", async () => "", { html: page("<p>v1</p>") });
    await db.update(samples).set({ html: page('<img src="photos/old.webp"><img src="photos/keep.webp">'), photos: [photo(s.id, "old.webp"), photo(s.id, "keep.webp")], status: "approved", approvedVersion: 1 }).where(eq(samples.id, s.id));
    expect((await sampleVersionsOf(db, tenant.id, s.id))[0].photosGone).toBe(0);
    await reviewSample(db, tenant.id, s.id, "takedown", { name: "Olu" });
    await db.update(samples).set({ url: "", photos: [photo(s.id, "keep.webp")] }).where(eq(samples.id, s.id));
    expect((await sampleVersionsOf(db, tenant.id, s.id))[0].photosGone).toBe(1);
    await expect(undoTakedown(db, tenant.id, s.id, { name: "Olu" })).rejects.toThrow(/1 picture of version 1 is gone/);
  });
});
