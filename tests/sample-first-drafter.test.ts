// A site keeps its first drafter's credit: when someone else drafts a later version, the card names both, the first one
// first ("Site Builder, reworked by site helper"). draftedBy keeps meaning the latest version's drafter (a request goes
// to it); firstDraftedBy is new, read from the kept versions, so no stored row changes.
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { writeLead, type Actor } from "@/lib/leads";
import { authorLine } from "@/lib/sample-labels";
import { listSamples, reviewSample, sampleCards, saveDraft } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";

const COPY = {
  headline: "Fresh tacos, made to order",
  intro: "A neighbourhood taqueria serving tacos, burritos and aguas frescas, seven days a week.",
  noticed: "Customers can only find you through your Google listing today.",
  sections: [
    { title: "What we make", body: "Tacos al pastor, carnitas and grilled vegetables, with tortillas pressed every morning." },
    { title: "Come by", body: "Walk in for a quick lunch or order for the whole office; we are open every day." },
  ],
  cta: "Message us on WhatsApp",
};
const NOMAP = async () => "";

describe("a site's first drafter", () => {
  it("the line names the first drafter, and the latest when another reworked it; any case counts as the same name", () => {
    expect(authorLine("Site Builder", "Site Builder")).toBe("Site Builder");
    expect(authorLine("Site Builder", "site helper")).toBe("Site Builder, reworked by site helper");
    expect(authorLine("Site Builder", "site builder")).toBe("Site Builder");
    expect(authorLine("", "site helper")).toBe("site helper");
    expect(authorLine("Site Builder", "site helper", (n) => `${n} (x)`)).toBe("Site Builder (x), reworked by site helper (x)");
  });

  it("is kept on the card and in the list when a later version is someone else's; draftedBy stays the latest", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const lead = async (business: string) => {
      const r = await writeLead(db, tenant.id, {}, { business, industry: "Mexican restaurant", city: "Springfield", package: "Starter Website", listing_evidence: "Google listing: 4.6★ (212 reviews)" }, OLU, { create: true });
      if (!r.ok) throw new Error(r.message);
      return r.lead.id;
    };
    const reworked = await lead("Taco Loco");
    const v1 = await saveDraft(db, tenant.id, reworked, undefined, COPY, "Site Builder", NOMAP);
    await reviewSample(db, tenant.id, v1.id, "changes", { name: "Olu" }, "Say they cater for offices too");
    await saveDraft(db, tenant.id, reworked, undefined, COPY, "site helper", NOMAP);
    const single = await lead("Bun Shop");
    await saveDraft(db, tenant.id, single, undefined, COPY, "Site Builder", NOMAP);

    const { cards } = await sampleCards(db, tenant.id);
    const card = (leadId: string) => cards.find((c) => c.leadId === leadId)!;
    expect([card(reworked).firstDraftedBy, card(reworked).draftedBy, card(reworked).version]).toEqual(["Site Builder", "site helper", 2]);
    expect([card(single).firstDraftedBy, card(single).draftedBy]).toEqual(["Site Builder", "Site Builder"]);
    const listed = await listSamples(db, tenant.id, {});
    expect(listed.map((s) => [s.leadId === reworked ? "reworked" : "single", s.firstDraftedBy, s.draftedBy]).sort()).toEqual([
      ["reworked", "Site Builder", "site helper"],
      ["single", "Site Builder", "Site Builder"],
    ]);
  });
});
