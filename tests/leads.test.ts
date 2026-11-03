import { describe, expect, it } from "vitest";
import { keyFor, mintKey, revokeKey } from "@/lib/api-keys";
import { memoryDb } from "@/lib/db";
import { batchWrite, domainOf, getLead, historyOf, listLeads, splitStatus, writeLead, type Actor } from "@/lib/leads";
import { createTenant } from "@/lib/tenants";

const ENRICHER: Actor = { kind: "bot", name: "Lead Enricher", via: "engine" };
const VALIDATOR: Actor = { kind: "bot", name: "validator", via: "validator" };
const BACKFILL: Actor = { kind: "bot", name: "backfill", via: "backfill" };

async function board() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const ANN: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const made = await writeLead(db, tenant.id, {}, { business: "Acme Bakery", website: "https://www.acmebakery.example/menu", location: "Queens, NY 11385, USA" }, ENRICHER, { create: true });
  if (!made.ok) throw new Error(made.message);
  return { db, tenantId: tenant.id, ANN, id: made.lead.id };
}

describe("the person-wins rule", () => {
  it("a bot never replaces a cell a person changed last; the attempt is kept as refused", async () => {
    const { db, tenantId, ANN, id } = await board();
    expect((await writeLead(db, tenantId, { id }, { contact_person: "Maria" }, ENRICHER)).ok).toBe(true);
    // the team corrects it
    const fix = await writeLead(db, tenantId, { id }, { contact_person: "Maria Lopez" }, ANN);
    expect(fix.ok && fix.written).toEqual(["contact_person"]);
    // a bot tries again: refused, the person's value stays
    const again = await writeLead(db, tenantId, { id }, { contact_person: "Maria", industry: "Bakery" }, ENRICHER);
    expect(again.ok && again.written).toEqual(["industry"]);
    expect(again.ok && again.refused).toEqual([{ field: "contact_person", reason: "person_wins", current: "Maria Lopez" }]);
    expect((await getLead(db, tenantId, { id }))?.contact_person).toBe("Maria Lopez");
    const h = await historyOf(db, tenantId, id);
    expect(h.find((x) => x.outcome === "refused")).toMatchObject({ column: "contact_person", outcome: "refused", reason: "person_wins", new: "Maria", old: "Maria Lopez", actor: { kind: "bot", name: "Lead Enricher", via: "engine" } });
    // a person may change a bot's value, and a bot a bot's
    expect((await writeLead(db, tenantId, { id }, { industry: "Bakery and cafe" }, ANN)).ok).toBe(true);
    const bots = await writeLead(db, tenantId, { id }, { site_health: "fast" }, VALIDATOR);
    const bots2 = await writeLead(db, tenantId, { id }, { site_health: "slow" }, ENRICHER);
    expect(bots.ok && bots2.ok && bots2.written).toEqual(["site_health"]);
  });

  it("the team's fields are refused to bots; fill-only leaves a filled cell; an unchanged value writes nothing", async () => {
    const { db, tenantId, ANN, id } = await board();
    const r = await writeLead(db, tenantId, { id }, { email_status: "Email Sent", result: "Replied", lead_score: 81 }, VALIDATOR);
    expect(r.ok && r.written).toEqual(["lead_score"]);
    expect(r.ok && r.refused.map((x) => [x.field, x.reason])).toEqual([
      ["email_status", "human_only"],
      ["result", "human_only"],
    ]);
    const sent = await writeLead(db, tenantId, { id }, { email_status: "Email Sent" }, ANN);
    expect(sent.ok && sent.lead).toMatchObject({ email_status: "Email Sent", sent_by: ["Olu"], status: ["Email Sent"] });
    expect(sent.ok && sent.lead.sent_at).toBeTruthy();
    const fill = await writeLead(db, tenantId, { id }, { website: "https://other.example", whatsapp: "https://wa.me/17185550100" }, ENRICHER, { fillOnly: true });
    expect(fill.ok && fill.written).toEqual(["whatsapp"]);
    expect(fill.ok && fill.refused[0]).toMatchObject({ field: "website", reason: "filled" });
    const before = (await getLead(db, tenantId, { id }))!.rev;
    const same = await writeLead(db, tenantId, { id }, { lead_score: 81 }, VALIDATOR);
    expect(same.ok && same.written).toEqual([]);
    expect((await getLead(db, tenantId, { id }))!.rev).toBe(before);
  });
});

describe("the since-cursor", () => {
  it("returns what changed after a rev, in order, in pages, and a changed row moves past the cursor", async () => {
    const { db, tenantId, id } = await board();
    for (const n of ["Bravo Barbers", "Cedar Clinic", "Delta Dental"]) await writeLead(db, tenantId, {}, { business: n, website: `https://${n.split(" ")[0].toLowerCase()}.example` }, ENRICHER, { create: true });
    const all = await listLeads(db, tenantId, { since: 0 });
    expect(all.leads.map((l) => l.business)).toEqual(["Acme Bakery", "Bravo Barbers", "Cedar Clinic", "Delta Dental"]);
    expect(all.more).toBe(false);
    const p1 = await listLeads(db, tenantId, { since: 0, limit: 2 });
    expect(p1.more).toBe(true);
    const p2 = await listLeads(db, tenantId, { since: p1.next, limit: 2 });
    expect([...p1.leads, ...p2.leads].map((l) => l.business)).toEqual(all.leads.map((l) => l.business));
    // nothing new: the same cursor back, no rows
    expect(await listLeads(db, tenantId, { since: all.next })).toEqual({ leads: [], next: all.next, more: false });
    // a change moves the row after the cursor
    await writeLead(db, tenantId, { id }, { lead_score: 90 }, VALIDATOR);
    const after = await listLeads(db, tenantId, { since: all.next });
    expect(after.leads.map((l) => l.business)).toEqual(["Acme Bakery"]);
    expect(after.next).toBeGreaterThan(all.next);
    // filters
    expect((await listLeads(db, tenantId, { minScore: 85 })).leads.map((l) => l.business)).toEqual(["Acme Bakery"]);
    expect((await listLeads(db, tenantId, { city: "queens" })).leads).toHaveLength(1);
    expect((await listLeads(db, tenantId, { hasDraft: false })).leads).toHaveLength(4);
  });

  it("keeps companies apart", async () => {
    const { db, tenantId, id } = await board();
    const other = await createTenant(db, "Bravo", "bravo", { email: "o@bravo.example", name: "B" });
    expect((await listLeads(db, other.tenant.id)).leads).toEqual([]);
    expect(await getLead(db, other.tenant.id, { id })).toBeNull();
    expect(await writeLead(db, other.tenant.id, { id }, { industry: "x" }, ENRICHER)).toMatchObject({ ok: false, code: "not_found" });
    expect((await listLeads(db, tenantId)).leads).toHaveLength(1);
  });
});

describe("batch writes", () => {
  it("each write on its own, answered in order; duplicates and bad fields refused without stopping the rest", async () => {
    const { db, tenantId, ANN, id } = await board();
    await writeLead(db, tenantId, { id }, { pain_point: "Pain point: no online menu" }, ANN);
    const r = await batchWrite(
      db,
      tenantId,
      [
        { id, fields: { lead_score: 77, pain_point: "Pain point: slow site" } },
        { fields: { business: "Acme Bakery Two", website: "https://acmebakery.example" }, create: true },
        { fields: { business: "Echo Eatery", website: "https://echo.example" }, create: true },
        { id, fields: { colour: "red" } },
        { id: "00000000-0000-4000-8000-000000000000", fields: { lead_score: 1 } },
      ],
      ENRICHER,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [a, b, c, d, e] = r.results;
    expect(a.ok && a.written).toEqual(["lead_score"]);
    expect(a.ok && a.refused[0].reason).toBe("person_wins");
    expect(b).toMatchObject({ ok: false, code: "duplicate_row", existingId: id });
    expect(c.ok && c.created).toBe(true);
    expect(d).toMatchObject({ ok: false, code: "bad_request", message: "unknown field: colour" });
    expect(e).toMatchObject({ ok: false, code: "not_found" });
    expect(await batchWrite(db, tenantId, Array.from({ length: 101 }, () => ({ id, fields: {} })), ENRICHER)).toMatchObject({ ok: false, code: "too_large" });
    expect(await batchWrite(db, tenantId, [], ENRICHER)).toMatchObject({ ok: false, code: "bad_request" });
  });
});

describe("the backfill's import", () => {
  const PAGE = "00000000000040008000000000000303";
  const NOTION = {
    business: "Fox Florist",
    website: "https://foxflorist.example",
    status: ["Email Sent", "WhatsApp Verified"],
    tools_on_site: ["Wix", "Meta Pixel"],
    lead_score: 64,
    result: null,
    result_date: "2026-10-20",
    sent_by: ["Sam"],
    package: "SMB Website Care Retainer",
    notion_url: "https://www.notion.so/Fox-Florist-00000000000040008000000000000303",
    notion_uid: "LD-412",
    created_at: "2026-09-24T10:11:00.000Z",
  };

  it("copies Notion as it is (the team's fields too), splits Status, keeps the Notion time, and is idempotent", async () => {
    const { db, tenantId } = await board();
    const first = await writeLead(db, tenantId, { notionPageId: PAGE }, NOTION, BACKFILL, { create: true, import: true });
    expect(first.ok && first.created).toBe(true);
    if (!first.ok) return;
    expect(first.lead).toMatchObject({ email_status: "Email Sent", whatsapp_status: "WhatsApp Verified", status: ["Email Sent", "WhatsApp Verified"], result_date: "2026-10-20", sent_by: ["Sam"], created_at: "2026-09-24T10:11:00.000Z", notion_page_id: PAGE, domain: "foxflorist.example" });
    const again = await writeLead(db, tenantId, { notionPageId: PAGE }, NOTION, BACKFILL, { create: true, import: true });
    expect(again.ok && !again.created && again.written).toEqual([]);
    expect(again.ok && again.lead.rev).toBe(first.lead.rev);
    // an import may also land on a domain already on the board (Notion holds chain rows)
    const chain = await writeLead(db, tenantId, { notionPageId: "a".repeat(32) }, { business: "Acme Bakery (2nd)", website: "https://acmebakery.example" }, BACKFILL, { create: true, import: true });
    expect(chain.ok).toBe(true);
    // Status values outside both tracks are refused
    expect(splitStatus(["Maybe"])).toEqual({ error: "status has values outside both tracks: Maybe" });
  });
});

describe("keys and small helpers", () => {
  it("a key names its company and scopes; a revoked or unknown key is no key", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "O" });
    const { id, token } = await mintKey(db, tenant.id, "engine", ["board:read", "board:write"]);
    expect(await keyFor(db, `Bearer ${token}`)).toMatchObject({ tenantId: tenant.id, name: "engine", scopes: ["board:read", "board:write"] });
    expect(await keyFor(db, `Bearer ${token}x`)).toBeNull();
    expect(await keyFor(db, token)).toBeNull();
    expect(await keyFor(db, null)).toBeNull();
    await revokeKey(db, tenant.id, id);
    expect(await keyFor(db, `Bearer ${token}`)).toBeNull();
    expect(JSON.stringify(await db.query.apiKeys.findMany())).not.toContain(token);
  });

  it("domains", () => {
    expect([domainOf("https://www.Acme.example/menu"), domainOf("acme.example"), domainOf(""), domainOf("not a url ::")]).toEqual(["acme.example", "acme.example", null, null]);
  });
});
