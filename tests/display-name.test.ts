// A person's name as Peek shows and records it: the name, else the email's first part, never the
// whole address; their own older records (written under the full address) still count as theirs.
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { displayName, namesOf } from "@/lib/display-name";
import { followUpsDue } from "@/lib/follow-up";
import { writeLead, type Actor } from "@/lib/leads";
import { createTenant } from "@/lib/tenants";

describe("displayName", () => {
  it("the name, else the part before @, never the whole address", () => {
    expect(displayName("Sampada Adhikary", "s@acme.example")).toBe("Sampada Adhikary");
    expect(displayName("  ", "owner.pos@gmail.com")).toBe("owner.pos");
    expect(displayName(null, "olu@acme.example")).toBe("olu");
    expect(displayName(null, null)).toBe("");
    expect(namesOf("", "olu@acme.example")).toEqual(["olu", "olu@acme.example"]);
    expect(namesOf("Olu", "olu@acme.example")).toEqual(["Olu", "olu@acme.example"]);
  });
});

describe("own sends under either name", () => {
  it("a send recorded under the full address still lists as the person's follow-up", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "olu@acme.example", name: "" });
    const OLD: Actor = { kind: "person", name: "olu@acme.example", userId: owner.id }; // how it was written before
    const r = await writeLead(db, tenant.id, {}, { business: "Old Shop", website: "https://oldshop.example", draft_email: "Hi" }, { kind: "bot", name: "Outreach Writer", via: "engine" }, { create: true });
    if (!r.ok) throw new Error("setup");
    await writeLead(db, tenant.id, { id: r.lead.id }, { email_status: "Email Sent" }, OLD, { sentAt: new Date("2026-10-26T10:00:00Z") });
    const now = new Date("2026-11-07T12:00:00");
    expect((await followUpsDue(db, tenant.id, namesOf("", "olu@acme.example"), now)).map((l) => l.business)).toEqual(["Old Shop"]);
    expect(await followUpsDue(db, tenant.id, "olu", now)).toEqual([]);
  });
});
