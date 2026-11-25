// The migration that works a street-like city out again from the location (a dry run found four rows),
// keeping places named like streets; and a write to a derived cell refused as "derived".
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { leadCells, leads } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { createTenant } from "@/lib/tenants";

const MIGRATION = readFileSync(path.join(process.cwd(), "drizzle", "0041_lead_city_fix.sql"), "utf8");

describe("0041 lead city fix", () => {
  it("works out the city of the four reported rows, keeps Bay Terrace and St. Albans, records each change and moves its rev", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const rows: [string, string, string, string | null][] = [
      ["Grandeur Hills Group", "276 Fifth Avenue", "276 Fifth Avenue, Suite 704, New York, NY 10001", "New York"],
      ["Simin Laser Aesthetics", "3009 Ocean Parkway", "3009 Ocean Parkway, Brooklyn, NY 11235, USA", "Brooklyn"],
      ["Innocore Pro Elevator Inc.", "36-18 Main St", "36-18 Main St, Suite 602, Flushing, NY 11354", "Flushing"],
      ["Red Note Rehearsal Studios", "1001 Irving Ave #7", "1001 Irving Ave #7, Ridgewood, NY 11385", "Ridgewood"],
      ["Ben's Kosher Delicatessen", "Bay Terrace", "Bay Terrace, NY, USA", "Bay Terrace"],
      ["Albans Bakery", "St. Albans", "St. Albans, NY 11412", "St. Albans"],
      ["No Place Known", "12 Main St", "12 Main St", null],
    ];
    const ids: string[] = [];
    for (const [business, city, location] of rows) {
      const [r] = await db.insert(leads).values({ tenantId: tenant.id, business, city, location, state: "NY" }).returning();
      ids.push(r.id);
    }
    const before = await db.select({ id: leads.id, rev: leads.rev }).from(leads);
    await db.execute(sql.raw(MIGRATION));
    const after = await db.select({ id: leads.id, city: leads.city, rev: leads.rev }).from(leads);
    const cityOf = (id: string) => after.find((r) => r.id === id)!.city;
    expect(ids.map(cityOf)).toEqual(rows.map((r) => r[3]));
    const moved = after.filter((r) => Number(r.rev) !== Number(before.find((b) => b.id === r.id)!.rev)).map((r) => r.id);
    expect(moved.sort()).toEqual([ids[0], ids[1], ids[2], ids[3], ids[6]].sort());
    const h = await db.select().from(leadCells).where(and(eq(leadCells.leadId, ids[0]), eq(leadCells.column, "city")));
    expect(h).toMatchObject([{ old: "276 Fifth Avenue", new: "New York", actorKind: "bot", reason: "derived", outcome: "applied" }]);
    // a second run changes nothing
    await db.execute(sql.raw(MIGRATION));
    expect((await db.select().from(leadCells).where(eq(leadCells.column, "city"))).length).toBe(5);
  });
});

describe("a write to a derived cell", () => {
  it("is refused as derived, not a silent 200; location still sets the city", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const bot = { kind: "bot", name: "Validator", via: "validator" } as Actor;
    const r = await writeLead(db, tenant.id, {}, { business: "Taco Loco", location: "31-15 Steinway St, Astoria, NY 11103" }, bot, { create: true });
    if (!r.ok) throw new Error(r.message);
    expect(r.lead.city).toBe("Astoria");
    const w = await writeLead(db, tenant.id, { id: String(r.lead.id) }, { city: "Queens", state: "NY" }, bot);
    expect(w).toMatchObject({ ok: true, written: [], refused: [{ field: "city", reason: "derived", current: "Astoria" }, { field: "state", reason: "derived", current: "NY" }] });
  });
});
