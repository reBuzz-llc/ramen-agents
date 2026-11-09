import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { DRAWER_ORDER } from "@/lib/lead-workflow";
import { writeLead, type Actor } from "@/lib/leads";
import { isSampleUrl, withSample } from "@/lib/sample-site";
import { createTenant } from "@/lib/tenants";

describe("the lead's sample site", () => {
  it("takes https links only", () => {
    expect(isSampleUrl("https://luna-salon.sample.example/")).toBe(true);
    for (const bad of ["http://luna.example", "luna.example", "https://localhost", "javascript:alert(1)", "ftp://x.example", ""]) expect(isSampleUrl(bad), bad).toBe(false);
  });
  it("a copied text ends with the link once, and not at all without a sample", () => {
    expect(withSample("Hi Ana,\nRegards\n", "https://s.example/luna")).toBe("Hi Ana,\nRegards\n\nYour sample site: https://s.example/luna");
    expect(withSample("See https://s.example/luna", "https://s.example/luna")).toBe("See https://s.example/luna");
    expect(withSample("Hi", null)).toBe("Hi");
    expect(withSample("Hi", "  ")).toBe("Hi");
  });
  it("is a person's cell: a person writes it, an agent cannot; a non-https link is refused", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const BOT: Actor = { kind: "bot", name: "Lead Enricher", via: "engine" };
    const made = await writeLead(db, tenant.id, {}, { business: "Luna Salon" }, OLU, { create: true });
    if (!made.ok) throw new Error(made.message);
    const id = made.lead.id;
    expect(await writeLead(db, tenant.id, { id }, { sample_url: "http://luna.example" }, OLU)).toMatchObject({ ok: false, code: "bad_request" });
    expect(await writeLead(db, tenant.id, { id }, { sample_url: "https://s.example/luna" }, OLU)).toMatchObject({ ok: true, written: ["sample_url"] });
    const bot = await writeLead(db, tenant.id, { id }, { sample_url: "https://other.example/x" }, BOT);
    expect(bot.ok && bot.refused.map((r) => r.reason)).toEqual(["human_only"]);
    expect(DRAWER_ORDER).toContain("sample_url");
  });
});
