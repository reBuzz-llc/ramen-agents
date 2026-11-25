// Members get full access to samples, approving and requesting changes included: a member has
// the Samples page as a manager has it, on every route. The Reference mark, the storage line and Delete stay where they were,
// and a member of another company reaches nothing.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/db";
import { samples, tenants, users } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { can } from "@/lib/roles";
import { openTakedown } from "@/lib/sample-takedowns";
import { putSamplePhoto, sampleCards, sampleFooter, saveDraft } from "@/lib/samples";
import { createSession } from "@/lib/session";
import { storage } from "@/lib/storage";
import { createTenant } from "@/lib/tenants";

const h = vi.hoisted(() => ({ db: null as unknown, who: null as unknown, token: null as string | null }));
vi.mock("@/lib/auth", () => ({ me: async () => h.who, sessionHint: async () => null }));
vi.mock("@/lib/db", async (real) => ({ ...(await real<typeof import("@/lib/db")>()), db: async () => h.db }));
vi.mock("next/headers", async (real) => ({ ...(await real<typeof import("next/headers")>()), cookies: async () => ({ get: () => (h.token ? { value: h.token } : undefined) }) }));
vi.mock("next/navigation", async (real) => ({ ...(await real<typeof import("next/navigation")>()), useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => "/samples" }));

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 6, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);
const NOMAP = async () => "";
const page = (body: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1>${body}${sampleFooter("Gamma Grill", "")}</body></html>`;
const NAME = "Mia Member";

type Person = { tenantId: string; userId: string; name: string; email: string; acked: true; role: "owner" | "manager" | "member"; tenantName: string; settings: Record<string, unknown> };

async function setup() {
  const db = await memoryDb();
  h.db = db;
  h.token = null;
  const a = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const b = await createTenant(db, "Other", "other", { email: "x@other.example", name: "Xan" });
  const addMember = async (tenantId: string, email: string, name: string) => (await db.insert(users).values({ tenantId, email, name, role: "member" }).returning())[0];
  const mia = await addMember(a.tenant.id, "mia@acme.example", NAME);
  const bo = await addMember(b.tenant.id, "bo@other.example", "Bo Outsider");
  const person = (tenantId: string, tenantName: string, u: { id: string; name: string | null; email: string }, role: Person["role"]): Person => ({ tenantId, userId: u.id, name: u.name ?? "", email: u.email, acked: true, role, tenantName, settings: {} });
  const member = person(a.tenant.id, "Acme", mia, "member");
  const outsider = person(b.tenant.id, "Other", bo, "member");
  const owner = person(a.tenant.id, "Acme", a.owner, "owner");
  const actor: Actor = { kind: "person", name: "Olu", userId: a.owner.id };
  const r = await writeLead(db, a.tenant.id, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, actor, { create: true });
  if (!r.ok) throw new Error(r.message);
  const lead = String(r.lead.id);
  const first = await saveDraft(db, a.tenant.id, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
  const st = await storage();
  await putSamplePhoto(db, a.tenant.id, first.id, "a.webp", WEBP, { guest: false, dish: "Galbi", by: "engine" }, st);
  const s = await saveDraft(db, a.tenant.id, lead, "eat", undefined, "Site Builder", NOMAP, { html: page('<img src="photos/a.webp" alt="a">') });
  const row = async () => (await db.select().from(samples).where(eq(samples.id, s.id)))[0];
  const card = async () => (await sampleCards(db, a.tenant.id)).cards[0];
  return { db, tenantId: a.tenant.id, id: s.id, version: s.version, lead, member, outsider, owner, row, card };
}

const as = (p: Person) => {
  h.who = p;
};
const HEAD = { origin: "http://peek.test", "x-forwarded-host": "peek.test" };
const post = (url: string, body: unknown) => new Request(`http://peek.test${url}`, { method: "POST", headers: { ...HEAD, "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (url: string) => new Request(`http://peek.test${url}`);
const params = <T,>(p: T) => ({ params: Promise.resolve(p) });

const decide = async (id: string, body: unknown) => (await import("@/app/api/samples/[id]/route")).POST(post(`/api/samples/${id}`, body), params({ id }));
const photoCheck = async (id: string, body: unknown) => (await import("@/app/api/samples/[id]/photo-checks/route")).POST(post(`/api/samples/${id}/photo-checks`, body), params({ id }));
const undo = async (id: string, body: unknown = {}) => (await import("@/app/api/samples/[id]/undo-takedown/route")).POST(post(`/api/samples/${id}/undo-takedown`, body), params({ id }));
const reference = async (id: string, action: string) => (await import("@/app/api/samples/[id]/reference/route")).POST(post(`/api/samples/${id}/reference`, { action, family: "eat" }), params({ id }));
const ask = async (id: string, text: string, picture = false) => {
  const form = new FormData();
  form.set("text", text);
  if (picture) {
    const { default: sharp } = await import("sharp");
    const png = await sharp({ create: { width: 2, height: 2, channels: 3, background: "#ff6600" } }).png().toBuffer();
    form.append("pictures", new File([new Uint8Array(png)], "p.png", { type: "image/png" }));
  }
  return (await import("@/app/api/samples/[id]/requests/route")).POST(new Request(`http://peek.test/api/samples/${id}/requests`, { method: "POST", headers: HEAD, body: form }), params({ id }));
};
const readers = async (id: string, lead: string) => {
  const list = (await import("@/app/api/samples/route")).GET;
  const preview = (await import("@/app/api/samples/[id]/preview/route")).GET;
  const signedPreview = (await import("@/app/samples/[id]/preview/route")).GET;
  const bundle = (await import("@/app/api/samples/[id]/bundle/route")).GET;
  const photo = (await import("@/app/api/samples/[id]/photos/[name]/route")).GET;
  return {
    list: await list(get(`/api/samples?lead_id=${lead}`)),
    preview: await preview(get(`/api/samples/${id}/preview`), params({ id })),
    signedPreview: await signedPreview(get(`/samples/${id}/preview`), params({ id })),
    bundle: await bundle(get(`/api/samples/${id}/bundle`), params({ id })),
    photo: await photo(get(`/api/samples/${id}/photos/a.webp`), params({ id, name: "a.webp" })),
  };
};

beforeAll(() => {
  process.env.FILES_DIR = mkdtempSync(path.join(tmpdir(), "peek-770-"));
});

describe("what each role may do", () => {
  it("a member reviews samples; the Reference mark stays with the owner and managers; no other page changes", () => {
    expect(can("member", "samples.review")).toBe(true);
    expect((["owner", "manager", "member"] as const).map((r) => can(r, "samples.reference"))).toEqual([true, true, false]);
    for (const other of ["week.team", "settings.keyResults", "settings.rates", "rates.members", "users.manage", "users.add", "leads.importsAll", "leads.markSent", "projects.manage", "keys.manage", "assets.edit"] as const) expect(can("member", other)).toBe(false);
  });
});

describe("a member on every samples route", () => {
  it("reads the list, both previews, the bundle and a photo", async () => {
    const t = await setup();
    as(t.member);
    const r = await readers(t.id, t.lead);
    for (const res of Object.values(r)) expect(res.status).toBe(200);
    const body = (await r.list.json()) as { samples: { id: string }[]; canReview: boolean };
    expect(body.samples.map((s) => s.id)).toEqual([t.id]);
    expect(body.canReview).toBe(true);
  });

  it("asks for changes with a picture and reads it back, under the member's name", async () => {
    const t = await setup();
    as(t.member);
    const res = await ask(t.id, "Warmer photos", true);
    expect(res.status).toBe(200);
    const made = (await res.json()) as { request: { id: string; pictures: number } };
    expect(made.request.pictures).toBe(1);
    const pic = (await import("@/app/api/samples/[id]/requests/[rid]/pictures/[n]/route")).GET;
    expect((await pic(get("/x"), params({ id: t.id, rid: made.request.id, n: "1" }))).status).toBe(200);
    const c = await t.card();
    expect(c.requests[0]).toMatchObject({ text: "Warmer photos", by: NAME });
    expect(c.reviewedBy).toBe(NAME);
  });

  it("accepts the photo, approves, takes down and puts it back, each under the member's name", async () => {
    const t = await setup();
    as(t.member);
    h.token = (await createSession(t.db, t.member.userId)).token;
    const CHECKS = ["people", "plates", "screens", "print"];
    expect((await photoCheck(t.id, { accept: ["a"], version: t.version })).status).toBe(400); // Accept all is gone
    const photo = (await import("@/app/api/samples/[id]/photos/[name]/route")).GET;
    const full = await photo(get(`/api/samples/${t.id}/photos/a.webp?view=full`), params({ id: t.id, name: "a.webp" }));
    expect([full.status, full.headers.get("cache-control")]).toEqual([200, "no-store"]);
    expect((await photoCheck(t.id, { base: "a", checks: CHECKS })).status).toBe(200); // no full-size look needed first
    expect((await decide(t.id, { action: "approve", version: t.version })).status).toBe(200);
    expect(await t.row()).toMatchObject({ status: "approved", reviewedBy: NAME, approvedVersion: t.version });
    const { default: SampleDetail } = await import("@/app/samples/sample-cards");
    const { createElement } = await import("react");
    expect(renderToStaticMarkup(createElement(SampleDetail, { c: await t.card(), backHref: "/samples" }))).toContain(`Last decision: ${NAME}`);

    expect((await decide(t.id, { action: "takedown", note: "Wrong address" })).status).toBe(200);
    expect(await t.row()).toMatchObject({ status: "taken_down", reviewedBy: NAME });
    const settings = async () => (await t.db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, t.tenantId)))[0].s as { sampleTakedowns?: Parameters<typeof openTakedown>[0] };
    expect(openTakedown((await settings()).sampleTakedowns, t.id)).toMatchObject({ by: NAME, reason: "Wrong address" });

    expect((await undo(t.id)).status).toBe(200);
    expect(await t.row()).toMatchObject({ status: "approved", reviewedBy: NAME });
    expect((await settings()).sampleTakedowns?.at(-1)).toMatchObject({ undoneBy: NAME });
  });

  it("rejects a photo with a note and sends it back as the member's request", async () => {
    const t = await setup();
    as(t.member);
    expect((await photoCheck(t.id, { base: "a", reject: true, note: "A face" })).status).toBe(200);
    const res = await photoCheck(t.id, { sendBack: true, version: t.version });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { sent: number }).sent).toBe(1);
    const c = await t.card();
    expect(c.requests[0].by).toBe(NAME);
    expect(c.requests[0].text).toContain("A face");
  });

  it("rejects a sample", async () => {
    const t = await setup();
    as(t.member);
    expect((await decide(t.id, { action: "reject", note: "Not a fit" })).status).toBe(200);
    expect(await t.row()).toMatchObject({ status: "rejected", reviewedBy: NAME });
  });

  it("is refused the Reference mark and Delete, and nothing changes", async () => {
    const t = await setup();
    as(t.member);
    for (const action of ["set", "family", "clear"]) expect((await reference(t.id, action)).status).toBe(403);
    await decide(t.id, { action: "reject", note: "Not a fit" });
    const { DELETE } = await import("@/app/api/samples/[id]/route");
    expect((await DELETE(new Request(`http://peek.test/api/samples/${t.id}`, { method: "DELETE", headers: HEAD }), params({ id: t.id }))).status).toBe(403);
    expect((await t.row()).id).toBe(t.id);
  });
});

describe("a member of another company", () => {
  it("reads nothing and changes nothing on any route", async () => {
    const t = await setup();
    const before = await t.row();
    as(t.outsider);
    const r = await readers(t.id, t.lead);
    expect(((await r.list.json()) as { samples: unknown[] }).samples).toEqual([]);
    for (const res of [r.preview, r.signedPreview, r.bundle, r.photo]) expect(res.status).toBe(404);
    for (const res of [
      await decide(t.id, { action: "approve", version: t.version }),
      await decide(t.id, { action: "changes", note: "Hello" }),
      await decide(t.id, { action: "takedown", note: "Hello" }),
      await decide(t.id, { action: "reject", note: "Hello" }),
      await undo(t.id),
      await ask(t.id, "Hello"),
      await photoCheck(t.id, { base: "a", reject: true }),
      await photoCheck(t.id, { base: "a", checks: ["people"] }),
      await photoCheck(t.id, { base: "a", dish: "Galbi" }),
      await photoCheck(t.id, { sendBack: true, version: t.version }),
    ])
      expect(res.status).toBe(404);
    const after = await t.row();
    expect({ status: after.status, reviewedBy: after.reviewedBy, photos: after.photos, version: after.version }).toEqual({ status: before.status, reviewedBy: before.reviewedBy, photos: before.photos, version: before.version });
    expect((await t.card()).requests).toEqual([]);
  });
});

describe("a request's picture", () => {
  it("opens for the member's company and not for another company's member", async () => {
    const t = await setup();
    as(t.member);
    const made = (await (await ask(t.id, "Warmer photos", true)).json()) as { request: { id: string } };
    const pic = (await import("@/app/api/samples/[id]/requests/[rid]/pictures/[n]/route")).GET;
    const open = () => pic(get("/x"), params({ id: t.id, rid: made.request.id, n: "1" }));
    expect((await open()).status).toBe(200);
    as(t.outsider);
    expect((await open()).status).toBe(404);
  });
});

describe("the page", () => {
  const render = async (p: Person, id: string) => {
    as(p);
    const { default: SamplesPage } = await import("@/app/samples/page");
    return renderToStaticMarkup(await SamplesPage({ searchParams: Promise.resolve({ s: id }) }));
  };

  it("shows a member the draft with its decisions, without the old notice, the storage line, the Reference switch or Delete", async () => {
    const t = await setup();
    const html = await render(t.member, t.id);
    expect(html).toContain("Gamma Grill");
    expect(html).toContain("Photos to check");
    expect(html).toContain("Approve version");
    expect(html).not.toContain("The owner and managers review");
    expect(html).not.toContain("data-storage");
    expect(html).not.toContain('role="switch"');
    expect(html).not.toContain("data-delete-sample");
    expect(await render(t.owner, t.id)).toContain("data-storage");
  });
});
