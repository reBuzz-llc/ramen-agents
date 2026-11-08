// Edit in place: a person's fix of an agent's draft is found in the history, a flag raised before it
// reads "you changed the draft since", the agents' text is kept beside it, and This week counts the drafts each person
// fixed (once per lead). A bot's edit never counts.
import { describe, expect, it } from "vitest";
import { accept } from "@/lib/claims";
import { memoryDb } from "@/lib/db";
import { changedSince, draftsFixedSince, lastPersonEdit } from "@/lib/draft-edits";
import { raiseFlag } from "@/lib/flags";
import { getLead, writeLead, type Actor } from "@/lib/leads";
import { packOf } from "@/lib/send-pack";
import { createTenant } from "@/lib/tenants";
import { setCheck, sendList } from "@/lib/whatsapp-pack";

const WRITER: Actor = { kind: "bot", name: "Outreach Writer", via: "engine" };

describe("draft edits", () => {
  it("finds a person's fix, keeps the agents' text, marks an earlier flag, counts it once per lead", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const r = await writeLead(db, tenant.id, {}, { business: "Acme Bakery", website: "https://acmebakery.example", business_email: "hi@acmebakery.example", draft_email: "Hi there, 40% more sales!" }, WRITER, { create: true });
    if (!r.ok) throw new Error(r.message);
    const id = r.lead.id;
    await accept(db, tenant.id, id, owner.id);
    await raiseFlag(db, tenant.id, id, "OW09", "an invented figure", "validator");
    expect((await packOf(db, tenant.id, owner.id))[0].flags).toEqual([{ rule: "OW09", detail: "an invented figure", changed: false }]);

    await new Promise((res) => setTimeout(res, 5));
    await writeLead(db, tenant.id, { id }, { draft_email: "Hi Maria, a short note about your menu." }, OLU);
    await writeLead(db, tenant.id, { id }, { draft_email: "Hi Maria, a short note about your online menu." }, OLU);
    expect(await getLead(db, tenant.id, { id })).toMatchObject({ draft_email: "Hi Maria, a short note about your online menu.", bot_draft: "Hi there, 40% more sales!" });
    expect((await lastPersonEdit(db, tenant.id, [id], "draft_email")).has(id)).toBe(true);
    expect((await packOf(db, tenant.id, owner.id))[0].flags[0].changed).toBe(true);
    expect(Object.fromEntries(await draftsFixedSince(db, tenant.id, "2000-01-01"))).toEqual({ Olu: 1 });
  });

  it("a bot's rewrite is not a person's fix; changedSince compares with the flag's first sighting", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const r = await writeLead(db, tenant.id, {}, { business: "Bravo", website: "https://bravo.example", draft_email: "v1" }, WRITER, { create: true });
    if (!r.ok) throw new Error(r.message);
    await writeLead(db, tenant.id, { id: r.lead.id }, { draft_email: "v2" }, WRITER);
    expect((await lastPersonEdit(db, tenant.id, [r.lead.id], "draft_email")).size).toBe(0);
    expect(await draftsFixedSince(db, tenant.id, "2000-01-01")).toEqual(new Map());
    expect(changedSince("2026-11-08T10:00:00Z", new Date("2026-11-08T11:00:00Z"))).toBe(true);
    expect(changedSince("2026-11-08T10:00:00Z", new Date("2026-11-08T09:00:00Z"))).toBe(false);
    expect(changedSince("2026-11-08T10:00:00Z", undefined)).toBe(false);
  });

  it("the WhatsApp tab marks a flag on a message the person rewrote", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const r = await writeLead(db, tenant.id, {}, { business: "Cedar", website: "https://cedar.example", whatsapp: "https://wa.me/17185550100", draft_whatsapp: "Hello!!!" }, WRITER, { create: true });
    if (!r.ok) throw new Error(r.message);
    await setCheck(db, tenant.id, r.lead.id, "verified", { userId: owner.id, name: "Olu" });
    await raiseFlag(db, tenant.id, r.lead.id, "WA02", "too many exclamation marks", "validator");
    await new Promise((res) => setTimeout(res, 5));
    await writeLead(db, tenant.id, { id: r.lead.id }, { draft_whatsapp: "Hello, a short note." }, OLU);
    expect((await sendList(db, tenant.id, owner.id))[0].flags).toEqual([{ rule: "WA02", detail: "too many exclamation marks", changed: true }]);
  });
});
