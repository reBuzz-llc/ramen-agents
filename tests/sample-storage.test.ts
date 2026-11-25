// The owner's line on Samples saying how full the free 1 GB file storage is, from what the
// rows record: the samples' photos, each Approve copy once, and the team's Files not deleted.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { files, sampleVersions, samples } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { storageLine } from "@/lib/sample-labels";
import { FREE_STORAGE, putLeadPhoto, saveDraft, sampleFooter, storageUse } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";

const KB = 1024;
const webp = (n: number) => { const b = new Uint8Array(n); b.set([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]); return b; };
const page = `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1><p>v1</p>${sampleFooter("Gamma Grill", "")}</body></html>`;

describe("702: photo storage for the owner", () => {
  it("the words", () => {
    expect(storageLine({ totalBytes: 33 * 1024 * 1024, sampleBytes: 19.1 * 1024 * 1024, samples: 3 }, FREE_STORAGE))
      .toBe("Photo storage: 33 MB of 1 GB used (3%) · sample photos 19 MB in 3 samples, the rest is the team's Files");
    expect(storageLine({ totalBytes: 512 * 1024, sampleBytes: 512 * 1024, samples: 1 })).toBe("Photo storage: 0.5 MB of 1 GB used (0%) · sample photos 0.5 MB in 1 sample, the rest is the team's Files");
  });

  it("adds photos, each Approve copy once (current and older versions), and Files not deleted", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const mk = async (business: string) => {
      const r = await writeLead(db, tenant.id, {}, { business, industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, OLU, { create: true });
      if (!r.ok) throw new Error(r.message);
      return r.lead.id;
    };
    const t = tenant.id;
    const store = { put: async () => {} };
    expect(await storageUse(db, t)).toEqual({ totalBytes: 0, sampleBytes: 0, fileBytes: 0, samples: 0 });
    const a = await mk("Gamma Grill");
    const s = await saveDraft(db, t, a, "eat", undefined, "Site Builder", async () => "", { html: page });
    await putLeadPhoto(db, t, a, "p1.webp", webp(150 * KB), { guest: false, dish: "", by: "site helper" }, store);
    await putLeadPhoto(db, t, a, "p1-2x.webp", webp(350 * KB), { guest: false, dish: "", by: "site helper" }, store);
    // a shell's photos count too
    await putLeadPhoto(db, t, await mk("Delta Deli"), "d.webp", webp(100 * KB), { guest: false, dish: "", by: "site helper" }, store);
    // Approve copies: the current one, and the same key again on an older version (counted once), and an older one
    const copy = (key: string, bytes?: number) => ({ src: "https://x", path: "assets/1.jpg", key, type: "image/jpeg", ...(bytes ? { bytes } : {}) });
    await db.update(samples).set({ assets: [copy(`samples/${s.id}/v2/1.jpg`, 200 * KB)] }).where(eq(samples.id, s.id));
    await db.insert(sampleVersions).values([
      { tenantId: t, sampleId: s.id, version: 1, template: "eat", html: "", madeAt: new Date(), assets: [copy(`samples/${s.id}/v1/1.jpg`, 120 * KB)] },
      { tenantId: t, sampleId: s.id, version: 2, template: "eat", html: "", madeAt: new Date(), assets: [copy(`samples/${s.id}/v2/1.jpg`, 200 * KB)] },
    ]);
    // the team's Files: one kept, one deleted
    await db.insert(files).values([
      { tenantId: t, key: "files/a.pdf", name: "a.pdf", size: 1024 * KB, contentType: "application/pdf", status: "ready" },
      { tenantId: t, key: "files/b.pdf", name: "b.pdf", size: 4096 * KB, contentType: "application/pdf", status: "ready", deletedAt: new Date() },
    ]);
    const sampleBytes = (150 + 350 + 100 + 200 + 120) * KB;
    expect(await storageUse(db, t)).toEqual({ totalBytes: sampleBytes + 1024 * KB, sampleBytes, fileBytes: 1024 * KB, samples: 2 });
  });
});
