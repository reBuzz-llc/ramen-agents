// Research first. The Validator's list, who is still waiting (a person's pain point
// takes a lead off at once), the fence on a bot's pain point or draft for a listed lead, and the Leads page's tab.
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { leads } from "@/lib/db/schema";
import { historyOf, writeLead, type Actor } from "@/lib/leads";
import { isListed, listProblem, parseList, researchFirst, waiting } from "@/lib/research-first";
import { saveList } from "@/lib/send-next";
import { createTenant } from "@/lib/tenants";

const ENRICHER: Actor = { kind: "bot", name: "Lead Enricher", via: "engine" };
const WRITER: Actor = { kind: "bot", name: "Outreach Writer", via: "engine" };
const DAY = 86400e3;

async function setup() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const mk = async (business: string, fields: Record<string, unknown> = {}) => {
    const r = await writeLead(db, tenant.id, {}, { business, website: `https://${business.split(" ")[0].toLowerCase()}.example`, ...fields }, OLU, { create: true });
    if (!r.ok) throw new Error(r.message);
    return String(r.lead.id);
  };
  return { db, t: tenant.id, OLU, mk };
}

describe("the list as the Validator pushes it", () => {
  it("keeps Peek ids (dashed or not) once each; a missing or bad since falls back to the list's time", () => {
    const l = parseList({
      generated_at: "2026-11-20T10:00:00Z",
      bar: 35,
      next: [
        { id: "8aee393602ce40809fa78c4ff030743f", since: "2026-11-10T09:00:00Z", score: 41 },
        { id: "8aee3936-02ce-4080-9fa7-8c4ff030743f", since: "2026-11-11T09:00:00Z" },
        { id: "nope" },
        { id: "11111111-2222-3333-4444-555555555555", since: "soon" },
        null,
      ],
    });
    expect(l.bar).toBe(35);
    expect(l.items).toEqual([
      { id: "8aee3936-02ce-4080-9fa7-8c4ff030743f", since: new Date("2026-11-10T09:00:00Z"), score: 41 },
      { id: "11111111-2222-3333-4444-555555555555", since: new Date("2026-11-20T10:00:00Z"), score: null },
    ]);
    expect(parseList(null).items).toEqual([]);
  });
  it("refuses a list without next, an entry without a Peek id, or more than 1,000 entries", () => {
    expect(listProblem({})).toMatch(/send the list/);
    expect(listProblem({ next: [{ id: "x" }] })).toBe("every entry names its lead by its Peek id");
    expect(listProblem({ next: Array.from({ length: 1001 }, () => ({ id: "8aee393602ce40809fa78c4ff030743f" })) })).toBe("at most 1000 entries in next");
    expect(listProblem({ next: [{ id: "8aee393602ce40809fa78c4ff030743f", since: "2026-11-20T10:00:00Z", score: 40 }] })).toBeNull();
  });
});

describe("the fence and who is still waiting", () => {
  it("a bot's pain point or draft on a listed lead is refused and kept in the history; its other cells, a person's write and an import are not", async () => {
    const { db, t, OLU, mk } = await setup();
    const a = await mk("Alder Spa"), b = await mk("Birch Dental"), c = await mk("Cedar Cafe");
    const since = new Date(Date.now() - 3 * DAY).toISOString();
    await saveList(db, t, "research-first", { generated_at: since, bar: 35, next: [{ id: a, since, score: 44 }, { id: b, since, score: 38 }] }, "validator");
    expect(await isListed(db, t, a)).toBe(true);
    expect(await isListed(db, t, c)).toBe(false);

    const r = await writeLead(db, t, { id: a }, { pain_point: "Pain point: no booking.", draft_email: "Hi", notes: "checked the site" }, ENRICHER);
    expect(r.ok && r.refused.map((x) => [x.field, x.reason])).toEqual([
      ["pain_point", "research_first"],
      ["draft_email", "research_first"],
    ]);
    expect(r.ok && r.written).toEqual(["notes"]);
    const refused = (await historyOf(db, t, a)).filter((h) => h.outcome === "refused");
    expect(refused.map((h) => [h.column, h.reason])).toEqual(expect.arrayContaining([["pain_point", "research_first"], ["draft_email", "research_first"]]));
    // not listed: written
    expect((await writeLead(db, t, { id: c }, { pain_point: "Pain point: x" }, ENRICHER)).ok && (await isListed(db, t, c))).toBe(false);
    // an import is never fenced
    const imp = await writeLead(db, t, { id: b }, { draft_whatsapp: "Hello" }, ENRICHER, { import: true });
    expect(imp.ok && imp.written).toEqual(["draft_whatsapp"]);

    // a person's pain point is never refused, and takes the lead off the list at once; then the Writer may draft it
    const p = await writeLead(db, t, { id: a }, { pain_point: "Pain point: the Book button says not set up (their /book page)." }, OLU);
    expect(p.ok && p.written).toEqual(["pain_point"]);
    expect(await isListed(db, t, a)).toBe(false);
    const w = await writeLead(db, t, { id: a }, { draft_email: "Hi Alder Spa team" }, WRITER);
    expect(w.ok && w.written).toEqual(["draft_email"]);
    expect((await waiting(db, t)).items.map((i) => i.id)).toEqual([b]);
  });

  it("a person's pain point from before the lead's since does not take it off", async () => {
    const { db, t, OLU, mk } = await setup();
    const a = await mk("Alder Spa");
    await writeLead(db, t, { id: a }, { pain_point: "an old note" }, OLU);
    const since = new Date(Date.now() + 1000).toISOString(); // listed after that write
    await saveList(db, t, "research-first", { generated_at: since, next: [{ id: a, since }] }, "validator");
    expect(await isListed(db, t, a)).toBe(true);
  });
});

describe("the Leads page's tab", () => {
  it("highest Lead score first, then the longest waiting; archived and unknown leads left out; the long-wait count", async () => {
    const { db, t, mk } = await setup();
    const a = await mk("Alder Spa", { lead_score: 38 }), b = await mk("Birch Dental", { lead_score: 52 }), c = await mk("Cedar Cafe"), d = await mk("Dune Clinic", { lead_score: 38 });
    await db.update(leads).set({ archived: true }).where(eq(leads.id, d)); // archived (writeLead does not take it)
    const now = new Date("2026-11-20T12:00:00Z");
    const at = (days: number) => new Date(now.getTime() - days * DAY).toISOString();
    await saveList(db, t, "research-first", {
      generated_at: at(0),
      bar: 35,
      next: [
        { id: a, since: at(2), score: 38 },
        { id: b, since: at(9), score: 52 },
        { id: c, since: at(10), score: 40 }, // no score on the board: the list's
        { id: d, since: at(1), score: 38 },
        { id: "99999999-9999-4999-8999-999999999999", since: at(1), score: 60 },
      ],
    }, "validator");
    const r = await researchFirst(db, t, now);
    expect(r.rows.map((x) => [x.business, x.score, x.days])).toEqual([
      ["Birch Dental", 52, 9],
      ["Cedar Cafe", 40, 10],
      ["Alder Spa", 38, 2],
    ]);
    expect([r.wait, r.long, r.bar]).toEqual([3, 2, 35]);
    expect(await researchFirst(await memoryDb(), t, now)).toEqual({ generatedAt: null, bar: null, rows: [], wait: 0, long: 0 });
  });
});
