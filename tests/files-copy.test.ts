// Files from Neon to Supabase: object by object, read back and compared, the row and its lead
// attachments written into the rebuilt database (its own company and people ids), resumable, a bad copy refused.
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { files, leadFiles, leads, users } from "@/lib/db/schema";
import { createTenant } from "@/lib/tenants";
import { copyFiles, supabaseS3 } from "../scripts/files-copy.mjs";

type Raw = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
const raw = (d: unknown) => (d as { $client: Raw }).$client;
const bucket = (store: Map<string, Uint8Array>, corrupt = false) => ({
  async get(key: string) {
    const b = store.get(key);
    if (!b) throw new Error(`no object ${key}`);
    return corrupt ? new Uint8Array([...b, 0]) : b;
  },
  async put(key: string, bytes: Uint8Array) {
    store.set(key, new Uint8Array(bytes));
  },
});

async function world() {
  const neon = await memoryDb();
  const supa = await memoryDb();
  const a = await createTenant(neon, "Acme", "acme", { email: "owner@acme.example", name: "Olu" });
  const b = await createTenant(supa, "Acme", "acme", { email: "owner@acme.example", name: "Olu" }); // other ids
  const [lead] = await neon.insert(leads).values({ tenantId: a.tenant.id, business: "Fiesta Lounge" }).returning();
  await supa.insert(leads).values({ id: lead.id, tenantId: b.tenant.id, business: "Fiesta Lounge" }); // the rebuild kept lead ids
  const bytes = new TextEncoder().encode("%PDF-1.7 brochure");
  const [f] = await neon.insert(files).values({ tenantId: a.tenant.id, key: `${a.tenant.id}/x.pdf`, name: "Brochure.pdf", size: bytes.length, contentType: "application/pdf", status: "ready", uploadedBy: a.owner.id }).returning();
  await neon.insert(leadFiles).values({ tenantId: a.tenant.id, leadId: lead.id, fileId: f.id, attachedBy: a.owner.id });
  const neonStore = new Map([[f.key, bytes]]);
  return { neon, supa, f, lead, b, neonStore };
}

describe("files-copy", () => {
  it("copies the object, checks it, writes the row as Supabase's with its attachment; a second run skips it", async () => {
    const w = await world();
    const supaStore = new Map<string, Uint8Array>();
    const logged: Record<string, unknown>[] = [];
    const r = await copyFiles({ from: raw(w.neon), to: raw(w.supa), fromBucket: bucket(w.neonStore), toBucket: bucket(supaStore), log: ((e: Record<string, unknown>) => void logged.push(e)) as never });
    expect([r.files, r.copied, r.failed, r.attachments]).toEqual([1, 1, 0, 1]);
    expect(supaStore.get(w.f.key)).toEqual(w.neonStore.get(w.f.key));
    const [row] = await w.supa.select().from(files);
    expect([row.id, row.store, row.tenantId, row.status]).toEqual([w.f.id, "supabase", w.b.tenant.id, "ready"]);
    expect(row.uploadedBy).toBe((await w.supa.select().from(users))[0].id); // the owner, by email
    expect((await w.supa.select().from(leadFiles)).map((x) => x.leadId)).toEqual([w.lead.id]);
    expect(logged[0]).toMatchObject({ status: "copied", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) });
    const again = await copyFiles({ from: raw(w.neon), to: raw(w.supa), fromBucket: bucket(w.neonStore), toBucket: bucket(supaStore) });
    expect([again.copied, again.skipped]).toEqual([0, 1]);
  });

  it("refuses a copy that reads back different, and writes no row for it", async () => {
    const w = await world();
    const r = await copyFiles({ from: raw(w.neon), to: raw(w.supa), fromBucket: bucket(w.neonStore), toBucket: bucket(new Map(), true) });
    expect([r.copied, r.failed]).toEqual([0, 1]);
    expect(await w.supa.select().from(files)).toEqual([]);
  });

  it("finds Supabase's S3 endpoint and region from its database address", () => {
    expect(supabaseS3("postgresql://postgres.abcdefghijkl:pw@aws-0-us-east-1.pooler.supabase.com:5432/postgres")).toEqual({ endpoint: "https://abcdefghijkl.supabase.co/storage/v1/s3", region: "us-east-1" });
  });
});

describe("the store a new upload records", () => {
  it("is FILES_STORE when an S3 store is set up, neon by default, local for the stand-in folder", async () => {
    const { storeName } = await import("@/lib/storage");
    const keep = { ...process.env };
    for (const k of ["AWS_ENDPOINT_URL_S3", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "FILES_STORE"]) delete process.env[k];
    expect(storeName()).toBe("local");
    Object.assign(process.env, { AWS_ENDPOINT_URL_S3: "https://x.example", AWS_ACCESS_KEY_ID: "a", AWS_SECRET_ACCESS_KEY: "b" });
    expect(storeName()).toBe("neon");
    process.env.FILES_STORE = "supabase";
    expect(storeName()).toBe("supabase");
    for (const k of ["AWS_ENDPOINT_URL_S3", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "FILES_STORE"]) if (keep[k] === undefined) delete process.env[k]; else process.env[k] = keep[k];
  });
});
