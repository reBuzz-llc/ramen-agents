// The Asset page's lists: the store, the seed from examples/assets.json, and the machine API.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mintKey } from "@/lib/api-keys";
import { addDraft, checkDraft, publishPackages, checkPackages, checkRates, knownIds, listPackages, listRates, savePackages, saveRates, splitLine } from "@/lib/assets";
import { memoryDb, type Db } from "@/lib/db";
import { can } from "@/lib/roles";
import { createTenant } from "@/lib/tenants";
import { seedFrom } from "../scripts/seed-assets.mjs";

let current: Db;
vi.mock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), db: async () => current }));

async function company(slug = "acme") {
  const db = await memoryDb();
  const { tenant } = await createTenant(db, slug, slug, { email: `o@${slug}.example`, name: "Olu" });
  return { db, tenantId: tenant.id };
}

describe("rate lines", () => {
  it("split at the first ': ' into offer and price", () => {
    expect(splitLine("Website refresh (one-off): $300-$500")).toEqual({ offer: "Website refresh (one-off)", price: "$300-$500" });
    expect(splitLine("Starter site: a one-page website, $500 one-time")).toEqual({ offer: "Starter site", price: "a one-page website, $500 one-time" });
    expect(splitLine("Quoted after a call")).toEqual({ offer: "Quoted after a call", price: "" });
  });

  it("take strings or {id, line}, drop empty lines, refuse a foreign id shape", () => {
    expect(checkRates(["A: $1", { line: "  B:  $2 " }, { line: "" }])).toEqual({ ok: true, items: [{ id: undefined, line: "A: $1" }, { id: undefined, line: "B: $2" }] });
    expect(checkRates([{ id: "x", line: "A" }])).toMatchObject({ ok: false });
    expect(checkRates("A: $1")).toMatchObject({ ok: false });
  });
});

describe("the seed", () => {
  it("reads the example file: rate lines in order, packages as drafts", () => {
    const { rates, packages } = seedFrom(JSON.parse(readFileSync(path.join(__dirname, "..", "examples", "assets.json"), "utf8")));
    expect(rates[0]).toBe("Starter site: a one-page website, $500 one-time");
    expect(packages.map((p: { name: string; status: string }) => [p.name, p.status])).toEqual([
      ["Starter site", "draft"],
      ["Website care", "draft"],
    ]);
    expect(seedFrom({ rates: ["  ", "A: $1"], packages: [{ price: "$1" }, { name: " B ", deliverables: ["x", " "] }] })).toEqual({
      rates: ["A: $1"],
      packages: [{ name: "B", price: "", offer: "", buyer: "", deliverables: ["x"], status: "draft" }],
    });
  });
});

describe("saving a list", () => {
  it("keeps the order sent, keeps ids, adds, changes and deletes in one step", async () => {
    const { db, tenantId } = await company();
    expect(await saveRates(db, tenantId, [{ line: "A: $1" }, { line: "B: $2" }, { line: "C: $3" }], "Olu")).toMatchObject({ ok: true, added: 3 });
    const [a, b, c] = await listRates(db, tenantId);
    expect([a.position, b.position, c.position]).toEqual([1, 2, 3]);
    const r = await saveRates(db, tenantId, [{ id: c.id, line: "C: $3" }, { id: a.id, line: "A: $10" }, { line: "D: $4" }], "Sam");
    expect(r).toEqual({ ok: true, added: 1, changed: 1, removed: 1 });
    const after = await listRates(db, tenantId);
    expect(after.map((x) => [x.line, x.position])).toEqual([
      ["C: $3", 1],
      ["A: $10", 2],
      ["D: $4", 3],
    ]);
    expect(after[0].id).toBe(c.id);
    expect(after[0].updatedBy).toBe("Olu"); // a move is not an edit
    expect(after[1].updatedBy).toBe("Sam");
  });

  it("refuses an id that is gone or another company's", async () => {
    const { db, tenantId } = await company();
    const { tenantId: other } = await createTenant(db, "Beta", "beta", { email: "o@beta.example", name: "Bo" }).then((x) => ({ tenantId: x.tenant.id }));
    await saveRates(db, other, [{ line: "Theirs: $5" }], "Bo");
    const [theirs] = await listRates(db, other);
    expect(await saveRates(db, tenantId, [{ id: theirs.id, line: "Mine: $1" }], "Olu")).toMatchObject({ ok: false });
    expect(await listRates(db, other)).toHaveLength(1);
  });

  it("packages: a name each, draft unless published, deliverables as lines; a filter for published", async () => {
    expect(checkPackages([{ price: "$1" }])).toMatchObject({ ok: false });
    expect(checkPackages([{ name: "X", status: "live" }])).toMatchObject({ ok: false });
    const c = checkPackages([
      { name: "Starter site", price: "$500 one-time", deliverables: "One page\n\nHosting set up", status: "published" },
      { name: "MVP Launchpad", buyer: "Seed founders" },
    ]);
    expect(c.ok && c.items.map((p) => [p.status, p.deliverables])).toEqual([
      ["published", ["One page", "Hosting set up"]],
      ["draft", []],
    ]);
    const { db, tenantId } = await company();
    await savePackages(db, tenantId, c.ok ? c.items : [], "Olu");
    expect((await listPackages(db, tenantId)).map((p) => p.name)).toEqual(["Starter site", "MVP Launchpad"]);
    expect((await listPackages(db, tenantId, "published")).map((p) => p.name)).toEqual(["Starter site"]);
  });

  it("a package's email keeps its line breaks; why and sources are kept, sources only as web addresses", async () => {
    const c = checkPackages([{ name: "Care", email: "Hi,\r\n\n\n\nWe keep your site up.  \nRegards,\n-- My team", why: "Below agency rates.", sources: ["https://a.example/p", "x"] }]);
    expect(c.ok && [c.items[0].email, c.items[0].why, c.items[0].sources]).toEqual(["Hi,\n\nWe keep your site up.\nRegards,\n-- My team", "Below agency rates.", ["https://a.example/p"]]);
    const { db, tenantId } = await company();
    await savePackages(db, tenantId, c.ok ? c.items : [], "Olu");
    const [p] = await listPackages(db, tenantId);
    expect(p.email).toBe("Hi,\n\nWe keep your site up.\nRegards,\n-- My team");
    expect(await savePackages(db, tenantId, [{ ...p, email: p.email + "\nP.S." }], "Olu")).toMatchObject({ changed: 1 });
  });

  it("the owner and managers edit; members read", () => {
    expect([can("owner", "assets.edit"), can("manager", "assets.edit"), can("member", "assets.edit")]).toEqual([true, true, false]);
  });
});

describe("GET and PUT /v1/assets/*", () => {
  let tenantId: string;
  beforeEach(async () => {
    const c = await company();
    current = c.db;
    tenantId = c.tenantId;
  });
  const call = async (method: "GET" | "PUT", list: string, token: string, body?: object, query = "") => {
    const route = await import("@/app/v1/assets/[list]/route");
    const req = new Request(`http://peek.test/v1/assets/${list}${query}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const res = await route[method](req, { params: Promise.resolve({ list }) });
    return { status: res.status, json: await res.json() };
  };

  it("a board:read key reads; only an assets:write key replaces", async () => {
    const validator = (await mintKey(current, tenantId, "validator", ["board:read", "board:write", "board:validate"])).token;
    const owner = (await mintKey(current, tenantId, "owner", ["board:read", "assets:write"])).token;
    expect((await call("PUT", "rates", validator, { rates: ["A: $1"] })).status).toBe(403);
    expect(await call("PUT", "rates", owner, { rates: ["Website Care Retainer: $249-$499/month", "Starter site: a one-page website, $500 one-time"] })).toMatchObject({ status: 200, json: { ok: true, added: 2 } });
    const got = await call("GET", "rates", validator);
    expect(got.status).toBe(200);
    expect(got.json.rates.map((r: { position: number; offer: string; price: string }) => [r.position, r.offer, r.price])).toEqual([
      [1, "Website Care Retainer", "$249-$499/month"],
      [2, "Starter site", "a one-page website, $500 one-time"],
    ]);
    expect(got.json.rates[0]).toMatchObject({ updated_by: "owner" });
    expect(got.json.updated_at).toEqual(expect.any(String));

    // a key never publishes: 405, nothing written
    const refused = await call("PUT", "packages", owner, { packages: [{ name: "A", status: "published" }, { name: "B" }] });
    expect([refused.status, refused.json.error.code]).toEqual([405, "person_only"]);
    expect((await call("GET", "packages", validator)).json.packages).toEqual([]);
    await call("PUT", "packages", owner, { packages: [{ name: "A", price: "$500" }, { name: "B" }] });
    const [a0] = (await call("GET", "packages", validator)).json.packages;
    await publishPackages(current, tenantId, [a0.id], "Olu"); // the person's click
    const list = (await call("GET", "packages", validator)).json.packages as { id: string; name: string; price: string }[];
    const keep = list.map((p) => ({ id: p.id, name: p.name, price: p.price, status: p.name === "A" ? "published" : "draft" }));
    expect((await call("PUT", "packages", owner, { packages: keep })).status).toBe(200); // unchanged published row: fine
    expect((await call("PUT", "packages", owner, { packages: keep.map((p) => (p.name === "A" ? { ...p, price: "$490" } : p)) })).status).toBe(405);
    expect((await call("PUT", "packages", owner, { packages: keep.filter((p) => p.name !== "A") })).status).toBe(405);
    expect((await call("GET", "packages", validator)).json.packages.map((p: { name: string; status: string }) => [p.name, p.status])).toEqual([
      ["A", "published"],
      ["B", "draft"],
    ]);
    expect((await call("GET", "packages", validator, undefined, "?status=published")).json.packages).toHaveLength(1);
    expect((await call("GET", "nope", validator)).status).toBe(404);
    expect((await call("GET", "rates", "peek_not-a-real-key-at-all-000")).status).toBe(401);
  });
});

describe("a bot's handover lands as a draft", () => {
  const PKG = { name: "Starter site", price: "$500 one-time", buyer: "Local shops with no website", deliverables: ["One page", "Hosting set up"], why: "Below the agency rates we read.", sources: ["https://agency.example/pricing", "not a url"] };

  it("needs a name, a price and a deliverable; keeps only web addresses as sources; never takes a status", () => {
    expect(checkDraft({ ...PKG, price: "" })).toMatchObject({ ok: false });
    expect(checkDraft({ ...PKG, deliverables: [] })).toMatchObject({ ok: false });
    const c = checkDraft({ ...PKG, status: "published" });
    expect(c.ok && c.draft).toEqual({ name: "Starter site", price: "$500 one-time", offer: "", buyer: "Local shops with no website", deliverables: ["One page", "Hosting set up"], why: "Below the agency rates we read.", sources: ["https://agency.example/pricing"] });
  });

  it("adds a draft at the end, updates the same bot's draft of that name, and never touches a published package", async () => {
    const { db, tenantId } = await company();
    await savePackages(db, tenantId, [{ name: "Starter site", price: "$500", offer: "", buyer: "", deliverables: [], status: "published", email: "", why: "", sources: [] }], "Olu");
    const d = checkDraft(PKG);
    if (!d.ok) throw new Error("bad draft");
    const a = await addDraft(db, tenantId, d.draft, "Package Designer");
    const b = await addDraft(db, tenantId, { ...d.draft, price: "$890 one-time" }, "Package Designer");
    expect([a.created, b.created, a.id === b.id]).toEqual([true, false, true]);
    const all = await listPackages(db, tenantId);
    expect(all.map((p) => [p.position, p.status, p.price, p.handedOverBy])).toEqual([
      [1, "published", "$500", null],
      [2, "draft", "$890 one-time", "Package Designer"],
    ]);
    expect(all[1].handedOverAt).toEqual(expect.any(String));
    expect(all[1].sources).toEqual(["https://agency.example/pricing"]);
  });

  it("a page saved after a handover keeps the draft it never loaded", async () => {
    const { db, tenantId } = await company();
    await savePackages(db, tenantId, [{ name: "A", price: "", offer: "", buyer: "", deliverables: [], status: "draft", email: "", why: "", sources: [] }, { name: "B", price: "", offer: "", buyer: "", deliverables: [], status: "draft", email: "", why: "", sources: [] }], "Olu");
    const loaded = await listPackages(db, tenantId);
    const d = checkDraft(PKG);
    if (!d.ok) throw new Error("bad draft");
    await addDraft(db, tenantId, d.draft, "Package Designer");
    // the page removes B and saves with the ids it had loaded
    const r = await savePackages(db, tenantId, [{ ...loaded[0], name: "A2" }], "Olu", knownIds(loaded.map((p) => p.id)));
    expect(r).toMatchObject({ ok: true, removed: 1, changed: 1 });
    const after = await listPackages(db, tenantId);
    expect(after.map((p) => [p.position, p.name])).toEqual([
      [1, "A2"],
      [2, "Starter site"],
    ]);
    expect(after[1].handedOverBy).toBe("Package Designer"); // an edit on the page keeps the handover
    // without `known` (the owner's PUT) the list is replaced
    await savePackages(db, tenantId, [{ ...after[0] }], "owner");
    expect(await listPackages(db, tenantId)).toHaveLength(1);
  });

  it("POST /v1/assets/packages/drafts takes a board:write key and answers 201, then 200", async () => {
    const c = await company();
    current = c.db;
    const engine = (await mintKey(current, c.tenantId, "engine", ["board:read", "board:write"])).token;
    const reader = (await mintKey(current, c.tenantId, "dashboard", ["board:read"])).token;
    const route = await import("@/app/v1/assets/[list]/drafts/route");
    const post = async (token: string, list = "packages", b: object = { ...PKG, by: "Package Designer" }) => {
      const res = await route.POST(new Request(`http://peek.test/v1/assets/${list}/drafts`, { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(b) }), { params: Promise.resolve({ list }) });
      return { status: res.status, json: await res.json() };
    };
    expect((await post(reader)).status).toBe(403);
    expect((await post(engine, "rates")).status).toBe(404);
    expect((await post(engine, "packages", { name: "X" })).status).toBe(400);
    expect(await post(engine)).toMatchObject({ status: 201, json: { ok: true, created: true, status: "draft" } });
    expect(await post(engine)).toMatchObject({ status: 200, json: { created: false } });
    const get = await import("@/app/v1/assets/[list]/route");
    const res = await get.GET(new Request("http://peek.test/v1/assets/packages", { headers: { authorization: `Bearer ${reader}` } }), { params: Promise.resolve({ list: "packages" }) });
    const [p] = (await res.json()).packages;
    expect(p).toMatchObject({ name: "Starter site", status: "draft", handed_over_by: "Package Designer", why: "Below the agency rates we read.", sources: ["https://agency.example/pricing"] });
    expect(p.handed_over_at).toEqual(expect.any(String));
  });
});

describe("publishing", () => {
  it("publishes only the company's drafts among the ids, as the person", async () => {
    const { db, tenantId } = await company();
    const { tenantId: other } = await createTenant(db, "Beta", "beta", { email: "o@beta.example", name: "Bo" }).then((x) => ({ tenantId: x.tenant.id }));
    const P = (name: string, status: "draft" | "published" = "draft") => ({ name, price: "$1", offer: "", buyer: "", deliverables: [], status, email: "", why: "", sources: [] });
    await savePackages(db, tenantId, [P("A"), P("B"), P("C", "published")], "Olu");
    await savePackages(db, other, [P("Theirs")], "Bo");
    const mine = await listPackages(db, tenantId);
    const [theirs] = await listPackages(db, other);
    const out = await publishPackages(db, tenantId, [...mine.map((p) => p.id), theirs.id, "not-an-id"], "Olu");
    expect(out.map((p) => p.name).sort()).toEqual(["A", "B"]);
    expect((await listPackages(db, tenantId)).every((p) => p.status === "published")).toBe(true);
    expect((await listPackages(db, other))[0].status).toBe("draft");
    expect((await listPackages(db, tenantId)).find((p) => p.name === "A")?.updatedBy).toBe("Olu");
  });
});
