// Undo take down: a taken-down sample goes back to where it was, its versions untouched. The
// publisher puts it up at the same address; a take-down a business or photographer asked for needs a person to say they checked.
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/db";
import { sampleVersions, samples, tenants } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { undoMessage } from "@/lib/sample-labels";
import { ALL_CHECKS } from "@/lib/sample-photo-checks";
import { openTakedown, withTakedown, withUndo } from "@/lib/sample-takedowns";
import { publishQueue, putSamplePhoto, reportPublish, reviewSample, sampleCards, sampleDoc, sampleFooter, saveDraft, setPhotoChecks, undoTakedown, type SampleCard } from "@/lib/samples";
import { references, setReference } from "@/lib/sample-references";
import { createTenant } from "@/lib/tenants";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const NOMAP = async () => "";
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);
const page = (body: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1>${body}${sampleFooter("Gamma Grill", "")}</body></html>`;
const WHO = { name: "Olu" };

async function setup() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const r = await writeLead(db, tenant.id, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, OLU, { create: true });
  if (!r.ok) throw new Error(r.message);
  return { db, t: tenant.id, lead: String(r.lead.id), OLU, store: { put: async () => {} } };
}
const URL_OF = (slug: string) => `https://acme-samples.pages.dev/${slug}/`;
type Ctx = Awaited<ReturnType<typeof setup>>;
/** A page approved and live, then taken down and off the web. */
async function downAndOff({ db, t, lead }: Ctx, opts: { note?: string; asked?: boolean } = {}) {
  const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
  await reviewSample(db, t, s.id, "approve", WHO, "", null, 1);
  await reportPublish(db, t, s.id, "published", URL_OF(s.slug));
  await reviewSample(db, t, s.id, "takedown", WHO, opts.note ?? "", undefined, undefined, { asked: opts.asked });
  return s;
}
const off = ({ db, t }: Ctx, id: string) => reportPublish(db, t, id, "unpublished", "");
const logOf = async ({ db, t }: Ctx) => (await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, t)))[0].s.sampleTakedowns ?? [];

describe("the take-down log", () => {
  const e = { sampleId: "a", reason: "r", asked: false, by: "O", at: "2026-11-21T10:00:00Z" };
  it("keeps one open record a sample, and an undo closes it", () => {
    const one = withTakedown([], e);
    expect(withTakedown(one, { ...e, reason: "again" })).toEqual(one);
    expect(openTakedown(one, "a")).toEqual(e);
    const closed = withUndo(one, "a", "M", "2026-11-21T11:00:00Z");
    expect(closed[0]).toMatchObject({ reason: "r", undoneBy: "M" });
    expect(openTakedown(closed, "a")).toBeNull();
  });
  it("a take-down from before the log still gets its undo line", () => {
    expect(withUndo([], "old", "M", "2026-11-21T11:00:00Z")).toMatchObject([{ sampleId: "old", undoneBy: "M" }]);
  });
});

describe("Undo take down", () => {
  it("back to approved at the same address, versions and ticks untouched, then live through the publisher", async () => {
    const x = await setup();
    const { db, t, lead, store } = x;
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    await putSamplePhoto(db, t, s.id, "a.webp", WEBP, { guest: true, dish: "A", by: "engine" }, store);
    await putSamplePhoto(db, t, s.id, "b.webp", WEBP, { guest: true, dish: "B", by: "engine" }, store);
    await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page('<img src="photos/a.webp" alt="A"><img src="photos/b.webp" alt="B">') });
    await setPhotoChecks(db, t, s.id, "a", ALL_CHECKS);
    await setPhotoChecks(db, t, s.id, "b", ALL_CHECKS);
    await reviewSample(db, t, s.id, "approve", WHO, "", null, 2);
    await reportPublish(db, t, s.id, "published", URL_OF(s.slug));
    await setPhotoChecks(db, t, s.id, "b", []);
    await reviewSample(db, t, s.id, "takedown", WHO);
    await expect(undoTakedown(db, t, s.id, WHO), "still on the web").rejects.toThrow(/still coming off the web/);
    await off(x, s.id);
    const before = await db.select().from(sampleVersions).where(eq(sampleVersions.sampleId, s.id));
    const html = (await sampleDoc(db, t, s.id))?.html;
    const back = await undoTakedown(db, t, s.id, { name: "Mira" });
    expect(back).toMatchObject({ status: "approved", approvedVersion: 2, version: 2, url: "", reviewedBy: "Mira", slug: s.slug });
    expect(await db.select().from(sampleVersions).where(eq(sampleVersions.sampleId, s.id))).toEqual(before);
    expect((await sampleDoc(db, t, s.id))?.html).toBe(html);
    const card = (await sampleCards(db, t)).cards[0];
    expect(card.photoChecks?.map((p) => [p.base, p.checks.length])).toEqual([["a", 4], ["b", 0]]);
    expect((await publishQueue(db, t, new Date(), async (k) => k)).map((i) => [i.slug, i.status])).toEqual([[s.slug, "approved"]]);
    expect(await reportPublish(db, t, s.id, "published", URL_OF(s.slug))).toMatchObject({ status: "live", url: URL_OF(s.slug) });
    expect((await logOf(x))[0]).toMatchObject({ by: "Olu", undoneBy: "Mira" });
  });

  it("a newer draft that was waiting waits again, with the approved version served", async () => {
    const x = await setup();
    const { db, t, lead } = x;
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    await reviewSample(db, t, s.id, "approve", WHO, "", null, 1);
    await reportPublish(db, t, s.id, "published", URL_OF(s.slug));
    await saveDraft(db, t, lead, "eat", undefined, "site helper", NOMAP, { html: page("<p>v2 waits</p>") }).catch(async () => {
      await db.update(samples).set({ version: 2, status: "draft", html: page("<p>v2 waits</p>") }).where(eq(samples.id, s.id));
      await db.insert(sampleVersions).values({ tenantId: t, sampleId: s.id, version: 1, template: "eat", html: page("<p>v1</p>"), kind: "page", madeAt: new Date() });
    });
    await reviewSample(db, t, s.id, "takedown", WHO);
    await off(x, s.id);
    expect(await undoTakedown(db, t, s.id, WHO)).toMatchObject({ status: "draft", approvedVersion: 1 });
    const [item] = await publishQueue(db, t);
    expect(item).toMatchObject({ version: 1, status: "approved" });
    expect(item.html).toContain("v1");
  });

  it("a take-down a business or photographer asked for needs the check, and its reason stays", async () => {
    const x = await setup();
    const s = await downAndOff(x, { note: "  The owner  asked by phone ", asked: true });
    await off(x, s.id);
    expect((await logOf(x))[0]).toMatchObject({ reason: "The owner asked by phone", asked: true });
    await expect(undoTakedown(x.db, x.t, s.id, WHO)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/check with them first/) });
    expect((await x.db.select().from(samples).where(eq(samples.id, s.id)))[0].status).toBe("taken_down");
    expect((await logOf(x))[0].undoneAt).toBeUndefined();
    expect((await undoTakedown(x.db, x.t, s.id, WHO, true)).status).toBe("approved");
  });

  it("the take-down's reason never lands in the note the Site Builder reads", async () => {
    const x = await setup();
    const s = await downAndOff(x, { note: "private reason" });
    expect((await x.db.select().from(samples).where(eq(samples.id, s.id)))[0].note).toBe("");
  });

  it("puts back the Reference mark the take-down removed", async () => {
    const x = await setup();
    const { db, t, lead } = x;
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    await reviewSample(db, t, s.id, "approve", WHO, "", null, 1);
    await reportPublish(db, t, s.id, "published", URL_OF(s.slug));
    await setReference(db, t, s.id, "Olu", "eat");
    expect((await references(db, t)).references).toHaveLength(1);
    await reviewSample(db, t, s.id, "takedown", WHO);
    expect((await references(db, t)).references).toHaveLength(0);
    await off(x, s.id);
    await undoTakedown(db, t, s.id, WHO);
    expect((await references(db, t)).references).toMatchObject([{ sampleId: s.id, version: 1, family: "eat" }]);
  });

  it("refuses a live sample, one with a website now, one never approved, and a page whose photo is gone", async () => {
    const x = await setup();
    const { db, t, lead, OLU, store } = x;
    const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
    await expect(undoTakedown(db, t, s.id, WHO)).rejects.toThrow(/only a taken-down sample/);
    await db.update(samples).set({ status: "taken_down" }).where(eq(samples.id, s.id));
    await expect(undoTakedown(db, t, s.id, WHO)).rejects.toThrow(/no version of it was approved/);
    await putSamplePhoto(db, t, s.id, "a.webp", WEBP, { guest: false, dish: "", by: "engine" }, store).catch(() => undefined);
    await db.update(samples).set({ approvedVersion: 1, html: page('<img src="photos/gone.webp" alt="x">') }).where(eq(samples.id, s.id));
    await expect(undoTakedown(db, t, s.id, WHO)).rejects.toThrow(/1 picture of version 1 is gone/);
    await db.update(samples).set({ html: page("<p>v1</p>") }).where(eq(samples.id, s.id));
    await writeLead(db, t, { id: lead }, { website: "https://gamma.example" }, OLU);
    await expect(undoTakedown(db, t, s.id, WHO)).rejects.toThrow(/has a website now/);
  });
});

describe("on the card", () => {
  const card = (over: Partial<SampleCard> = {}) => ({ id: "11111111-2222-4333-8444-555555555570", leadId: "l", business: "A Test Cafe", area: "Queens, NY", trade: "Cafe", template: "eat", status: "taken_down", version: 7,
    draftedAt: "2026-11-21T10:55:00Z", draftedBy: "Site Builder", reviewedBy: "", url: "", hold: false, frozen: false, note: "", leadHref: "/leads?lead=l", kind: "page", changes: "", designReason: "", sources: [],
    open: "/samples/x/preview", pages: [], guestPhotos: [], approvedVersion: 7, requests: [], ...over }) as SampleCard;
  const render = async (over: Partial<SampleCard>, canMark: boolean) => {
    const { default: SampleDetail } = await import("@/app/samples/sample-cards");
    return renderToStaticMarkup(createElement(SampleDetail, { c: card(over), isOwner: canMark, canMark, backHref: "/samples" }));
  };
  it("the button is there for anyone on the page on a taken-down sample with an approved version, and nowhere else", async () => {
    expect(await render({}, true)).toContain("Undo take down");
    expect(await render({}, false)).toContain("Undo take down"); // a member
    expect(await render({ approvedVersion: null }, true)).not.toContain("Undo take down");
    expect(await render({ status: "rejected" }, true)).not.toContain("Undo take down");
    expect(await render({ status: "live" }, true)).not.toContain("Undo take down");
  });
  it("the message says it becomes public again, or why not yet", () => {
    const NOW = Date.parse("2026-11-21T12:00:00Z");
    expect(undoMessage({ hold: false }, "2026-11-21T11:56:00Z", NOW)).toBe("Put back: it becomes public again on the publisher's next run (it last ran 4 min ago).");
    expect(undoMessage({ hold: true }, "2026-11-21T11:56:00Z", NOW)).toMatch(/on hold/);
    expect(undoMessage({ hold: false }, null, NOW)).toMatch(/paused/);
  });
});
