// The reviewer reads a sample's own uploaded photos with the engine's key, before a person approves.
// Read-only, its own company's only, a name on the sample's list only.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import * as route from "@/app/v1/samples/[id]/photos/[name]/route";
import { mintKey } from "@/lib/api-keys";
import { memoryDb, type Db } from "@/lib/db";
import { writeLead, type Actor } from "@/lib/leads";
import { putSamplePhoto, sampleFooter, saveDraft } from "@/lib/samples";
import { samples } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createTenant } from "@/lib/tenants";

const h = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/db", async (real) => ({ ...(await real<typeof import("@/lib/db")>()), db: async () => h.db }));

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);
const NOMAP = async () => "";
const page = `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1>${sampleFooter("Gamma Grill", "")}</body></html>`;

async function company(db: Db, slug: string) {
  const { tenant, owner } = await createTenant(db, slug, slug, { email: `o@${slug}.example`, name: "Olu" });
  const who: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const r = await writeLead(db, tenant.id, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", package: "Starter Website" }, who, { create: true });
  if (!r.ok) throw new Error(r.message);
  const s = await saveDraft(db, tenant.id, String(r.lead.id), "eat", undefined, "Site Builder", NOMAP, { html: page });
  await putSamplePhoto(db, tenant.id, s.id, "dish.webp", WEBP, { guest: false, dish: "Bulgogi", by: "engine" });
  return { t: tenant.id, id: s.id };
}

const get = (id: string, name: string, token?: string) =>
  route.GET(new Request(`http://peek.test/v1/samples/${id}/photos/${name}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }), { params: Promise.resolve({ id, name }) });

describe("GET /v1/samples/<id>/photos/<name> (782)", () => {
  let db: Db;
  let a: { t: string; id: string };
  let b: { t: string; id: string };
  let engine: string;
  let readOnly: string;

  beforeAll(async () => {
    process.env.FILES_DIR = mkdtempSync(path.join(tmpdir(), "peek-782-"));
    db = await memoryDb();
    h.db = db;
    a = await company(db, "acme");
    b = await company(db, "other");
    engine = (await mintKey(db, a.t, "engine", ["board:read", "board:write"])).token;
    readOnly = (await mintKey(db, a.t, "dashboard", ["board:read"])).token;
  });

  it("the engine key reads its company's sample photo, as an image that never runs as a page", async () => {
    const r = await get(a.id, "dish.webp", engine);
    expect(r.status).toBe(200);
    expect(new Uint8Array(await r.arrayBuffer())).toEqual(WEBP);
    expect(r.headers.get("content-type")).toBe("image/webp");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("content-security-policy")).toContain("sandbox");
  });

  it("another company's photo is refused, the same as one that does not exist", async () => {
    const r = await get(b.id, "dish.webp", engine);
    expect(r.status).toBe(404);
    expect(await r.json()).toEqual(await (await get(a.id, "none.webp", engine)).json());
  });

  it("only a name on the sample's own list", async () => {
    for (const name of ["none.webp", "..%2F..%2Fsecret.webp", "dish.gif", "DISH.webp"]) expect((await get(a.id, name, engine)).status).toBe(404);
  });

  it("no key, or a key that cannot upload photos, reads nothing", async () => {
    expect((await get(a.id, "dish.webp")).status).toBe(401);
    expect((await get(a.id, "dish.webp", "not-a-key")).status).toBe(401);
    expect((await get(a.id, "dish.webp", readOnly)).status).toBe(403);
  });

  it("opens no new write verb and a read changes nothing", async () => {
    expect(Object.keys(route).sort()).toEqual(["DELETE", "GET", "PUT"]);
    const before = await db.select({ photos: samples.photos, updatedAt: samples.updatedAt }).from(samples).where(eq(samples.id, a.id));
    await get(a.id, "dish.webp", engine);
    expect(await db.select({ photos: samples.photos, updatedAt: samples.updatedAt }).from(samples).where(eq(samples.id, a.id))).toEqual(before);
  });
});
