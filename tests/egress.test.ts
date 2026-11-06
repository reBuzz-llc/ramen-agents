// Egress (to keep within a free tier's data transfer): list reads pick their cells, answer 304
// with no body when nothing changed, say their size, and each key's day is counted; /api/health names a quota stop.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { keyDays, mintKey } from "@/lib/api-keys";
import { memoryDb, type Db } from "@/lib/db";
import { dbState } from "@/lib/db-state";
import { fieldsOf, LONG_FIELDS, writeLead, type Actor } from "@/lib/leads";
import { createTenant } from "@/lib/tenants";

let current: Db;
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), db: async () => current }));
const BOT: Actor = { kind: "bot", name: "Lead Enricher", via: "engine" };

async function setup() {
  current = await memoryDb();
  const { tenant } = await createTenant(current, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const key = await mintKey(current, tenant.id, "engine", ["board:read", "board:write"]);
  await writeLead(current, tenant.id, {}, { business: "Acme Bakery", website: "https://acmebakery.example", draft_email: "Hi, a long draft ".repeat(40), pain_point: "Pain point: slow site" }, BOT, { create: true });
  return { tenantId: tenant.id, key };
}
const get = async (token: string, qs: string, headers: Record<string, string> = {}) => {
  const { GET } = await import("@/app/v1/boards/[board]/rows/route");
  return GET(new Request(`http://peek.test/v1/boards/leads/rows${qs}`, { headers: { authorization: `Bearer ${token}`, ...headers } }), { params: Promise.resolve({ board: "leads" }) });
};

describe("fields", () => {
  it("all by default until PEEK_SLIM_DEFAULT; slim leaves the long cells out; a list names cells; unknown refused", () => {
    const all = fieldsOf(undefined, false);
    const slimDefault = fieldsOf(undefined, true);
    expect(all.ok && all.keys.has("draft_email")).toBe(true);
    expect(slimDefault.ok && [...LONG_FIELDS].some((k) => slimDefault.keys.has(k))).toBe(false);
    const slim = fieldsOf("slim");
    expect(slim.ok && slim.keys.has("business") && !slim.keys.has("pain_point")).toBe(true);
    const some = fieldsOf("business,draft_email");
    expect(some.ok && [...some.keys]).toEqual(["business", "draft_email"]);
    expect(fieldsOf("business,password").ok).toBe(false);
  });
});

describe("a list read", () => {
  beforeEach(() => vi.resetModules());

  it("fields=slim answers no drafts or pain point, and is smaller; x-peek-bytes is the body's size", async () => {
    const { key } = await setup();
    const full = await get(key.token, "?since=0");
    const slim = await get(key.token, "?since=0&fields=slim");
    const [f, s] = [await full.text(), await slim.text()];
    expect(JSON.parse(f).leads[0].draft_email).toContain("long draft");
    const lead = JSON.parse(s).leads[0];
    expect(lead.business).toBe("Acme Bakery");
    expect("draft_email" in lead || "pain_point" in lead).toBe(false);
    expect(s.length).toBeLessThan(f.length);
    expect(Number(slim.headers.get("x-peek-bytes"))).toBe(Buffer.byteLength(s));
  });

  it("answers 304 with no body for the same ETag while nothing changed, 200 again after a write; each key's day counted", async () => {
    const { tenantId, key } = await setup();
    const first = await get(key.token, "?since=0&fields=slim");
    const etag = first.headers.get("etag")!;
    expect(etag).toMatch(/^W\/"leads-\d+-[0-9a-f]{12}"$/);
    const again = await get(key.token, "?since=0&fields=slim", { "if-none-match": etag });
    expect(again.status).toBe(304);
    expect(await again.text()).toBe("");
    await writeLead(current, tenantId, {}, { business: "Bo's Deli", website: "https://bosdeli.example" }, BOT, { create: true });
    const changed = await get(key.token, "?since=0&fields=slim", { "if-none-match": etag });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("etag")).not.toBe(etag);
    const day = (await keyDays(current, tenantId)).get(key.id)!;
    expect([day.requests, day.notModified]).toEqual([3, 1]);
    expect(day.bytes).toBeGreaterThan(0);
  });
});

describe("/api/health", () => {
  it("names Neon's quota stop apart from any other failure", () => {
    expect(dbState(new Error("Your account or project has exceeded the quota. Upgrade your plan to increase limits."))).toBe("quota");
    expect(dbState({ message: "x", code: "53300" })).toBe("quota");
    expect(dbState(new Error("connect ECONNREFUSED"))).toBe("down");
  });
});
