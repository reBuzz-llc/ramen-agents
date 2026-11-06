import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { getLead, writeLead, type Actor } from "@/lib/leads";
import { e164, telHref } from "@/lib/phone";
import { createTenant } from "@/lib/tenants";

describe("phone numbers in E.164", () => {
  it("turns the common US shapes into +1 and ten digits", () => {
    for (const raw of ["(718) 555-0161", "718-555-0161", "718.555.0161", "7185550161", "1 718 555 0161", "+1 718-555-0161", " +17185550161 "]) expect(e164(raw)).toBe("+17185550161");
  });
  it("keeps a country code, and a 00 prefix becomes +", () => {
    expect(e164("+44 20 7946 0958")).toBe("+442079460958");
    expect(e164("0044 20 7946 0958")).toBe("+442079460958");
  });
  it("drops an extension and keeps anything that is not a number as written", () => {
    expect(e164("(718) 555-0161 ext. 12")).toBe("+17185550161");
    expect(e164("call the front desk")).toBe("call the front desk");
    expect(e164("555-0161")).toBe("555-0161");
  });
  it("gives a tel: link only for a real number", () => {
    expect(telHref("+17185550161")).toBe("tel:+17185550161");
    expect(telHref("(718) 555-0161")).toBe("tel:+17185550161");
    expect(telHref("ask at the counter")).toBeNull();
  });
});

describe("the phone cell on the board", () => {
  it("is stored in E.164 for bots and people alike, and a person's number wins over a bot's", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const BOT: Actor = { kind: "bot", name: "validator", via: "validator" };
    const PERSON: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const made = await writeLead(db, tenant.id, {}, { business: "Acme Bakery", phone: "(718) 555-0161" }, BOT, { create: true });
    if (!made.ok) throw new Error("not made");
    const id = made.lead.id;
    expect((await getLead(db, tenant.id, { id }))?.phone).toBe("+17185550161");
    expect((await writeLead(db, tenant.id, { id }, { phone: "718.555.0100" }, PERSON)).ok).toBe(true);
    const again = await writeLead(db, tenant.id, { id }, { phone: "+17185550161" }, BOT);
    expect(again.ok && again.refused).toEqual([{ field: "phone", reason: "person_wins", current: "+17185550100" }]);
    expect((await getLead(db, tenant.id, { id }))?.phone).toBe("+17185550100");
  });
});
