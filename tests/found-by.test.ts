// An agent's new lead carries found_by, the writing agent's display
// name, when the create left it empty. The engine never sent it, so Lead Gen's rows since 11-08 had none.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mintKey } from "@/lib/api-keys";
import { memoryDb, type Db } from "@/lib/db";
import { leadCells } from "@/lib/db/schema";
import { writeLead } from "@/lib/leads";
import { createTenant } from "@/lib/tenants";
import { eq } from "drizzle-orm";

let current: Db;
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), db: async () => current }));

async function setup() {
  current = await memoryDb();
  const { tenant, owner } = await createTenant(current, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const key = await mintKey(current, tenant.id, "engine", ["board:read", "board:write"]);
  return { tenantId: tenant.id, owner, key };
}
const post = async (token: string, body: unknown) => {
  const { POST } = await import("@/app/v1/boards/[board]/rows/route");
  const r = await POST(new Request("http://peek.test/v1/boards/leads/rows", { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", origin: "http://peek.test" }, body: JSON.stringify(body) }), {
    params: Promise.resolve({ board: "leads" }),
  });
  return { status: r.status, body: (await r.json()) as { lead?: { id: string; found_by: string | null }; written?: string[] } };
};

describe("found_by on an agent's new lead (931)", () => {
  beforeEach(() => vi.resetModules());

  it("is the writing agent's display name: Lead Gen on the engine key gives \"Lead Gen\", recorded in the lead's history", async () => {
    const { key } = await setup();
    const r = await post(key.token, { actor: "Lead Gen", fields: { business: "Acme Bakery", website: "https://acmebakery.example" } });
    expect(r.status).toBe(201);
    expect(r.body.lead?.found_by).toBe("Lead Gen");
    expect(r.body.written).toContain("found_by");
    const h = await current.select().from(leadCells).where(eq(leadCells.leadId, r.body.lead!.id));
    expect(h.find((c) => c.column === "found_by")).toMatchObject({ new: "Lead Gen", actorKind: "bot", actorName: "Lead Gen", via: "engine" });
  });

  it("with no actor named it is the key's name; a value the agent sends is ignored, not an error", async () => {
    const { key } = await setup();
    expect((await post(key.token, { fields: { business: "Bun Shop", website: "https://bun.example" } })).body.lead?.found_by).toBe("engine");
    expect((await post(key.token, { actor: "Lead Gen", fields: { business: "Cake Shop", website: "https://cake.example", found_by: " " } })).body.lead?.found_by).toBe("Lead Gen");
    const pie = await post(key.token, { actor: "Lead Gen", fields: { business: "Pie Shop", website: "https://pie.example", found_by: "Scout" } });
    expect([pie.status, pie.body.lead?.found_by]).toEqual([201, "Lead Gen"]);
  });

  it("an agent's update cannot change it; a person's can still write it, and an import's sets its own", async () => {
    const { tenantId, owner, key } = await setup();
    const made = await post(key.token, { actor: "Lead Gen", fields: { business: "Rice Shop", website: "https://rice.example" } });
    const id = made.body.lead!.id;
    const bot = { kind: "bot" as const, name: "Lead Enricher", via: "engine" };
    const b = await writeLead(current, tenantId, { id }, { found_by: "Scout", notes: "checked" }, bot);
    expect(b.ok && [b.lead.found_by, b.lead.notes]).toEqual(["Lead Gen", "checked"]);
    const person = { kind: "person" as const, name: "Olu", userId: owner.id };
    const p = await writeLead(current, tenantId, { id }, { found_by: "Olu" }, person);
    expect(p.ok && p.lead.found_by).toBe("Olu");
    const imp = await writeLead(current, tenantId, {}, { business: "Jam Shop", website: "https://jam.example", found_by: "import: owner file 2026-11-24" }, person, { create: true, import: true });
    expect(imp.ok && imp.lead.found_by).toBe("import: owner file 2026-11-24");
  });

  it("a person's create and an import's are unchanged: no found_by is added", async () => {
    const { tenantId, owner } = await setup();
    const person = { kind: "person" as const, name: "Olu", userId: owner.id };
    const a = await writeLead(current, tenantId, {}, { business: "Tea Room", website: "https://tea.example" }, person, { create: true });
    expect(a.ok && a.lead.found_by).toBe(null);
    const bot = { kind: "bot" as const, name: "Lead Gen", via: "engine" };
    const b = await writeLead(current, tenantId, {}, { business: "Soup Bar", website: "https://soup.example" }, bot, { create: true, import: true });
    expect(b.ok && b.lead.found_by).toBe(null);
  });

  it("an agent's update of a lead does not add it", async () => {
    const { tenantId, owner } = await setup();
    const person = { kind: "person" as const, name: "Olu", userId: owner.id };
    const a = await writeLead(current, tenantId, {}, { business: "Tea Room", website: "https://tea.example" }, person, { create: true });
    const bot = { kind: "bot" as const, name: "Lead Enricher", via: "engine" };
    const b = await writeLead(current, tenantId, { id: a.ok ? a.lead.id : "" }, { notes: "checked" }, bot);
    expect(b.ok && b.lead.found_by).toBe(null);
  });
});
