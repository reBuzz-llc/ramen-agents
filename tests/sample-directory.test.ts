// The public directory's cards: only the allowed facts leave Peek; a take-down reaches the blog.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { samples } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { directory, directoryItem, waLinkOf } from "@/lib/sample-directory";
import { createTenant } from "@/lib/tenants";

const ENGINE: Actor = { kind: "bot", name: "Lead Gen", via: "engine" };

describe("sample directory", () => {
  it("builds a wa.me link from the WhatsApp cell only", () => {
    expect(waLinkOf("https://wa.me/17185550160")).toBe("https://wa.me/17185550160");
    expect(waLinkOf("+1 (718) 555-0160")).toBe("https://wa.me/17185550160");
    expect(waLinkOf("call us")).toBeNull();
    expect(waLinkOf(null)).toBeNull();
  });

  it("a live card carries the allowed facts and nothing else; a gone one only its id and status", () => {
    const lead = { business: "  Cobot   Bakery ", city: "Queens", state: "NY", whatsapp: "+1 718 555 0160", listing: null, listingEvidence: "Google listing: 4.6★ (212 reviews), Bakery, open 7 days" };
    const live = directoryItem({ id: "a", status: "live", template: "restaurant", url: "https://cobot.pages.dev", updatedAt: new Date("2026-11-09T10:00:00Z") }, lead);
    expect(live).toEqual({ id: "a", status: "live", updated_at: "2026-11-09T10:00:00.000Z", business: "Cobot Bakery", trade: "restaurant", city: "Queens", state: "NY", rating: 4.6, reviews: 212, url: "https://cobot.pages.dev", whatsapp: "https://wa.me/17185550160" });
    expect(Object.keys(live).sort()).toEqual(["business", "city", "id", "rating", "reviews", "state", "status", "trade", "updated_at", "url", "whatsapp"]);
    expect(directoryItem({ id: "a", status: "live", template: "shop", url: "http://x.example", updatedAt: new Date() }, lead).url).toBeNull();
    const gone = directoryItem({ id: "b", status: "taken_down", template: "shop", url: "https://x.pages.dev", updatedAt: new Date() }, lead);
    expect([gone.business, gone.url, gone.whatsapp, gone.city]).toEqual(["", null, null, null]);
  });

  it("lists live samples; with since, every change (a take-down too)", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const r = await writeLead(db, tenant.id, {}, { business: "Cobot Bakery", website: "https://cobot.example", whatsapp: "+1 718 555 0160", business_email: "hi@cobot.example", address: "12 Main St" }, ENGINE, { create: true });
    if (!r.ok) throw new Error(r.message);
    const [s] = await db.insert(samples).values({ tenantId: tenant.id, leadId: r.lead.id, slug: "cobot", template: "restaurant", status: "live", url: "https://cobot.pages.dev" }).returning();
    const list = await directory(db, tenant.id);
    expect(list.map((x) => x.business)).toEqual(["Cobot Bakery"]);
    expect(JSON.stringify(list)).not.toMatch(/hi@cobot|Main St|718 555/);
    const before = new Date(Date.now() - 1000);
    await db.update(samples).set({ status: "taken_down", updatedAt: new Date() }).where(eq(samples.id, s.id));
    expect(await directory(db, tenant.id)).toEqual([]);
    const changed = await directory(db, tenant.id, before);
    expect(changed.map((x) => [x.id, x.status])).toEqual([[s.id, "taken_down"]]);
  });
});
