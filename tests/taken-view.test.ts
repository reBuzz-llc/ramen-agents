import { describe, expect, it } from "vitest";
import { accept } from "@/lib/claims";
import { memoryDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { writeLead } from "@/lib/leads";
import { summaryOf, takenView, valueText } from "@/lib/taken-view";
import { addUser, createTenant } from "@/lib/tenants";

const WRITER = { kind: "bot" as const, name: "Outreach Writer", via: "engine" };

describe("the Taken page (layout B)", () => {
  it("held and sent-this-week leads, each with every person's change named, agents marked, someone else flagged", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const jas = await addUser(db, tenant.id, "mina@acme.example", "Mina");
    const son = await addUser(db, tenant.id, "kai@acme.example", "Kai");
    const make = async (business: string) => (await writeLead(db, tenant.id, {}, { business }, WRITER, { create: true })) as { ok: true; lead: { id: string } };
    const a = (await make("Amerco Construction")).lead.id;
    const b = (await make("Beta Shoes")).lead.id;
    const c = (await make("Corner Bakery")).lead.id;
    await writeLead(db, tenant.id, { id: a }, { draft_whatsapp: "Hello Amerco, we noticed you have no website." }, WRITER);
    await accept(db, tenant.id, a, jas.id, "whatsapp");
    await accept(db, tenant.id, b, jas.id);
    await writeLead(db, tenant.id, { id: a }, { contact_person: "Mark Ruiz" }, { kind: "person", name: "Mina", userId: jas.id });
    await writeLead(db, tenant.id, { id: a }, { draft_whatsapp: "Hi Mark,\nwe noticed you have no website." }, { kind: "person", name: "Kai", userId: son.id });
    // Corner Bakery: the first member sent it this week (Sent by), so it left her claims but stays on the page as sent
    await writeLead(db, tenant.id, { id: c }, { email_status: "Email Sent", sent_by: ["Mina"], sent_at: new Date().toISOString() }, { kind: "person", name: "Mina", userId: jas.id });

    const people = await db.select({ id: users.id, name: users.name, email: users.email, role: users.role }).from(users);
    const items = await takenView(db, tenant.id, people.find((p) => p.id === jas.id)!, people, new Date(Date.now() - 86400e3));
    expect(items.map((i) => [i.business, i.kind, i.sent])).toEqual([
      ["Amerco Construction", "WhatsApp", false],
      ["Beta Shoes", "Email", false],
      ["Corner Bakery", "Email", true],
    ]);
    const amerco = items[0].changes;
    const contact = amerco.find((x) => x.field === "Contact person" || x.after === "Mark Ruiz")!;
    expect([contact.who, contact.person, contact.other, contact.before, contact.after]).toEqual(["Mina", true, false, "", "Mark Ruiz"]);
    const rewrite = amerco.filter((x) => x.after.startsWith("Hi Mark"))[0];
    expect([rewrite.who, rewrite.other, rewrite.long, rewrite.before]).toEqual(["Kai", true, true, "Hello Amerco, we noticed you have no website."]);
    const agent = amerco.find((x) => !x.person)!;
    expect(agent.who).toBe("Outreach Writer");
    expect(amerco.map((x) => x.id)).toEqual([...amerco.map((x) => x.id)].sort((p, q) => p - q)); // oldest first
    expect(summaryOf(items)).toEqual({ held: 2, sent: 1, changedToday: 2, bySomeoneElse: 1 });

    // the second member's own page: she holds nothing and sent nothing, even though she changed a lead
    expect(await takenView(db, tenant.id, people.find((p) => p.id === son.id)!, people, new Date(Date.now() - 86400e3))).toEqual([]);
  });

  it("values as text: lists joined, nothing empty", () => {
    expect(valueText(["Mina", "Kai"])).toBe("Mina, Kai");
    expect(valueText(null)).toBe("");
    expect(valueText("  x ")).toBe("x");
    expect(valueText(3)).toBe("3");
  });
});
