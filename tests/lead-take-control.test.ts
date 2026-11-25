// Take it sits to the left of the copy icons on a lead, shows who took it, can be taken only once, and only
// the person who took it is offered Give back.
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import TakeControl, { type Holder } from "@/app/leads/take-control";
import { memoryDb } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { writeLead } from "@/lib/leads";
import { createTenant } from "@/lib/tenants";

const h = vi.hoisted(() => ({ db: null as unknown, who: null as unknown }));
vi.mock("@/lib/auth", () => ({ me: async () => h.who, sessionHint: async () => null }));
vi.mock("@/lib/db", async (real) => ({ ...(await real<typeof import("@/lib/db")>()), db: async () => h.db }));

const render = (holder: Holder | null, meId: string) => renderToStaticMarkup(createElement(TakeControl, { holder, meId, busy: false, onTake: () => {}, onGiveBack: () => {} }));
const MIA = { userId: "mia", name: "Mia Member" };

describe("the control", () => {
  it("offers Take it on a free lead", () => {
    const html = render(null, "mia");
    expect(html).toContain("Take it");
    expect(html).not.toContain("Give back");
  });
  it("the person who took it sees that and Give back", () => {
    const html = render(MIA, "mia");
    expect(html).toContain("Taken by you");
    expect(html).toContain("Give back");
    expect(html).not.toContain("Take it");
  });
  it("anyone else sees who took it, with neither button", () => {
    const html = render(MIA, "bo");
    expect(html).toContain("Taken by Mia Member");
    expect(html).not.toContain("Give back");
    expect(html).not.toContain("Take it");
  });
  it("sits to the left of the copy icons, and the old button under the steps is gone", () => {
    const src = readFileSync(path.join(process.cwd(), "app/leads/leads-view.tsx"), "utf8");
    expect(src.indexOf("<TakeControl")).toBeGreaterThan(-1);
    expect(src.indexOf("<TakeControl")).toBeLessThan(src.indexOf("<CopyLink id={id} />"));
    expect(src).not.toContain('{taken ? "Give back" : "Take it"}');
  });
});

describe("taking a lead through the routes", () => {
  it("one holder at a time: the second person is refused, cannot give it back, and sees who has it", async () => {
    const db = await memoryDb();
    h.db = db;
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const add = async (email: string, name: string) => (await db.insert(users).values({ tenantId: tenant.id, email, name, role: "member" }).returning())[0];
    const [mia, bo] = [await add("mia@acme.example", "Mia Member"), await add("bo@acme.example", "Bo Member")];
    const r = await writeLead(db, tenant.id, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY" }, { kind: "person", name: "Olu", userId: owner.id }, { create: true });
    if (!r.ok) throw new Error(r.message);
    const id = String(r.lead.id);
    const as = (u: { id: string; name: string | null; email: string }) => {
      h.who = { tenantId: tenant.id, userId: u.id, name: u.name, email: u.email, acked: true, role: "member", tenantName: "Acme", settings: {} };
    };
    const { POST } = await import("@/app/api/queue/claim/route");
    const { GET } = await import("@/app/api/leads/[id]/route");
    const claim = (action: string) => POST(new Request("http://peek.test/api/queue/claim", { method: "POST", headers: { origin: "http://peek.test", "x-forwarded-host": "peek.test", "content-type": "application/json" }, body: JSON.stringify({ pageId: id, action }) }));
    const holder = async () => ((await (await GET(new Request(`http://peek.test/api/leads/${id}`), { params: Promise.resolve({ id }) })).json()) as { holder: Holder | null }).holder;

    as(mia);
    expect(await holder()).toBeNull();
    expect((await claim("accept")).status).toBe(200);
    as(bo);
    expect(await holder()).toEqual({ userId: mia.id, name: "Mia Member" });
    expect((await claim("accept")).status).toBe(409);
    expect((await claim("release")).status).toBe(403);
    expect(await holder()).toEqual({ userId: mia.id, name: "Mia Member" });
    as(mia);
    expect((await claim("release")).status).toBe(200);
    expect(await holder()).toBeNull();
    as(bo);
    expect((await claim("accept")).status).toBe(200);
    expect(await holder()).toEqual({ userId: bo.id, name: "Bo Member" });
  });
});
