// A simple box per photo: one Accept or Reject per photo, the four rules
// said once. Approve waits for every photo; a rejected one goes back to the builder as a change request and never goes up.
import { eq } from "drizzle-orm";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/db";
import { samples } from "@/lib/db/schema";
import { writeLead, type Actor } from "@/lib/leads";
import { ALL_CHECKS, photosLeft, photosRejected, PHOTO_RULES, rejectRequests, reviewPhotos, sentBackMessage, withChecks, withRejection, type ReviewPhoto } from "@/lib/sample-photo-checks";
import type { SamplePhoto } from "@/lib/sample-photos";
import { publishQueue, putSamplePhoto, rejectPhoto, requestsOf, reviewOf, reviewSample, sampleCards, sampleFooter, saveDraft, sendBackRejected, setPhotoChecks, undoTakedown, type SampleCard } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 9, 9]);
const NOMAP = async () => "";
const page = (body: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body><h1>Gamma Grill</h1>${body}${sampleFooter("Gamma Grill", "")}</body></html>`;
const imgs = (...names: string[]) => page(names.map((n) => `<img src="photos/${n}.webp" alt="${n}">`).join(""));
const entry = (name: string, over: Partial<SamplePhoto> = {}) => ({ name, bytes: 10, guest: false, dish: "", ...over });
const OLU = { name: "Olu" };
const META = { guest: true, dish: "Galbi", by: "engine" };

async function setup(...names: string[]) {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
  const actor: Actor = { kind: "person", name: "Olu", userId: owner.id };
  const r = await writeLead(db, tenant.id, {}, { business: "Gamma Grill", industry: "Restaurant", location: "Astoria, NY", whatsapp: "https://wa.me/17185550100", package: "Starter Website" }, actor, { create: true });
  if (!r.ok) throw new Error(r.message);
  const t = tenant.id;
  const lead = String(r.lead.id);
  const store = { put: async () => {} };
  const s = await saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: page("<p>v1</p>") });
  for (const n of names) await putSamplePhoto(db, t, s.id, `${n}.webp`, WEBP, META, store);
  // the builder names what it answered
  const draft = async (...on: string[]) => saveDraft(db, t, lead, "eat", undefined, "Site Builder", NOMAP, { html: imgs(...on), answers: (await requestsOf(db, t, s.id, "open")).map((r) => r.id) });
  const v2 = await draft(...names);
  return { db, t, id: s.id, version: v2.version, draft, store };
}
const cardOf = async (db: Awaited<ReturnType<typeof memoryDb>>, t: string) => (await sampleCards(db, t)).cards[0];
const goLive = (db: Awaited<ReturnType<typeof memoryDb>>, id: string) => db.update(samples).set({ status: "live", url: "https://samples.example/gamma/", publishedAt: new Date() }).where(eq(samples.id, id));

describe("the decisions, pure", () => {
  it("Reject drops the checks and keeps the note; a full Accept clears it; fewer checks leave it rejected", () => {
    const no = withRejection([entry("a.webp", { checks: ALL_CHECKS }), entry("a-2x.webp", { checks: ALL_CHECKS })], "a", "A face", "2026-11-22T10:00:00Z");
    const [row] = reviewPhotos(no, ["a.webp", "a-2x.webp"]);
    expect(row).toMatchObject({ rejected: true, note: "A face", checks: [] });
    expect(photosLeft([row])).toBe(0);
    expect(photosRejected([row])).toBe(1);
    expect(withChecks(no, "a", ["people"], "2026-11-22T11:00:00Z")).toEqual(no);
    const yes = withChecks(no, "a", ALL_CHECKS, "2026-11-22T11:00:00Z");
    expect(yes[0]).toMatchObject({ checks: ALL_CHECKS });
    expect(yes[0]).not.toHaveProperty("rejected");
    expect(yes[0]).not.toHaveProperty("rejectNote");
  });

  it("one old copy left keeps a photo rejected", () => {
    const list = [entry("a.webp", { rejected: true }), entry("a-2x.webp")];
    expect(reviewPhotos(list, ["a.webp", "a-2x.webp"])[0].rejected).toBe(true);
  });

  it("a long list goes as several requests, each inside the 1000-character limit, every photo in one", () => {
    const rows: ReviewPhoto[] = Array.from({ length: 12 }, (_, i) => ({ base: `p${i}`, file: `p${i}.webp`, full: `p${i}.webp`, fullAt: "", guest: true, dish: "Galbi", dishSet: true, checks: [], rejected: true, note: "x".repeat(200) }));
    const out = rejectRequests(rows);
    expect(out.length).toBeGreaterThan(1);
    for (const text of out) expect(text.length).toBeLessThanOrEqual(1000);
    for (const p of rows) expect(out.filter((x) => x.includes(`photos/${p.file}`))).toHaveLength(1);
  });

  it("says when a version stays on the web", () => {
    expect(sentBackMessage(2, null)).toBe("Sent back: the Site Builder removes 2 photos in its next version.");
    expect(sentBackMessage(1, 23)).toMatch(/Version 23 stays on the web, with it, until a version without it is approved\. If it has to go now, use Take down\./);
  });
});

describe("Approve and sending back", () => {
  it("Approve waits for every photo and refuses a rejected one; the send-back files one request and the draft goes back", async () => {
    const { db, t, id, version } = await setup("a", "b");
    await expect(reviewSample(db, t, id, "approve", OLU, "", null)).rejects.toThrow(/^2 photos still need Accept or Reject/);
    await setPhotoChecks(db, t, id, "a", ALL_CHECKS);
    expect(await rejectPhoto(db, t, id, "b", "  a   face ")).toEqual({ note: "a face", left: 0, rejected: 1 });
    await expect(reviewSample(db, t, id, "approve", OLU, "", null)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/^1 photo on this page was rejected/) });
    expect(await sendBackRejected(db, t, id, OLU, version)).toEqual({ sent: 1, requests: 1 });
    const [ask] = await requestsOf(db, t, id, "open");
    expect(ask.text).toContain("photos/b.webp (Galbi): a face");
    expect(ask.text).not.toContain("photos/a.webp");
    expect(ask.byName).toBe("Olu");
    expect((await cardOf(db, t)).status).toBe("changes_requested");
    await expect(sendBackRejected(db, t, id, OLU, version)).rejects.toMatchObject({ status: 409 });
    expect(await requestsOf(db, t, id, "open")).toHaveLength(1);
  });

  it("a draft sends back only when every photo is decided, and never for a version it did not see", async () => {
    const { db, t, id, version } = await setup("a", "b");
    await rejectPhoto(db, t, id, "a", "");
    await expect(sendBackRejected(db, t, id, OLU, version)).rejects.toThrow(/^1 photo still needs Accept or Reject/);
    await setPhotoChecks(db, t, id, "b", ALL_CHECKS);
    await expect(sendBackRejected(db, t, id, OLU, version - 1)).rejects.toThrow(/newer version arrived/);
    expect(await requestsOf(db, t, id)).toHaveLength(0);
  });

  it("a next version that still shows the photo cannot be approved; one without it can", async () => {
    const { db, t, id, version, draft } = await setup("a", "b");
    await setPhotoChecks(db, t, id, "a", ALL_CHECKS);
    await rejectPhoto(db, t, id, "b", "A plate");
    await sendBackRejected(db, t, id, OLU, version);
    await draft("a", "b");
    let c = await cardOf(db, t);
    expect(c.photoChecks?.find((p) => p.base === "b")).toMatchObject({ rejected: true, note: "A plate" });
    await expect(reviewSample(db, t, id, "approve", OLU, "", null)).rejects.toThrow(/was rejected/);
    await draft("a");
    c = await cardOf(db, t);
    expect(c.photoChecks?.map((p) => p.base)).toEqual(["a"]);
    expect((await reviewSample(db, t, id, "approve", OLU, "", null)).status).toBe("approved");
  });

  it("replacing a rejected photo reopens it, and a new version asks only about the photos it adds", async () => {
    const { db, t, id, draft, store } = await setup("a", "b", "c");
    await setPhotoChecks(db, t, id, "a", ALL_CHECKS);
    await rejectPhoto(db, t, id, "b", "A face");
    await putSamplePhoto(db, t, id, "b.webp", WEBP, META, store);
    let c = await cardOf(db, t);
    const b = c.photoChecks?.find((p) => p.base === "b");
    expect(b?.rejected).toBeUndefined();
    expect(b?.checks).toEqual([]);
    await draft("a", "c");
    c = await cardOf(db, t);
    expect(c.photoChecks?.map((p) => [p.base, p.checks.length])).toEqual([["a", 4], ["c", 0]]);
  });
});

describe("a rejected photo and the web", () => {
  it("a page already live stays up and the card says so; the send-back keeps it live", async () => {
    const { db, t, id, version } = await setup("a");
    await setPhotoChecks(db, t, id, "a", ALL_CHECKS);
    await reviewSample(db, t, id, "approve", OLU, "", null);
    await goLive(db, id);
    await rejectPhoto(db, t, id, "a", "A face");
    expect((await cardOf(db, t)).photoChecks?.[0]).toMatchObject({ rejected: true, onWeb: true });
    expect((await publishQueue(db, t, new Date(), async () => "https://x/1")).find((i) => i.id === id)?.html).toContain("Gamma Grill");
    await sendBackRejected(db, t, id, OLU, version);
    expect((await cardOf(db, t)).status).toBe("live");
    expect(await requestsOf(db, t, id, "open")).toHaveLength(1);
  });

  it("an approved page not up yet does not go up once a photo is rejected", async () => {
    const { db, t, id } = await setup("a");
    await setPhotoChecks(db, t, id, "a", ALL_CHECKS);
    await reviewSample(db, t, id, "approve", OLU, "", null);
    expect((await publishQueue(db, t, new Date(), async () => "https://x/1")).some((i) => i.id === id)).toBe(true);
    await rejectPhoto(db, t, id, "a", "");
    expect((await publishQueue(db, t, new Date(), async () => "https://x/1")).some((i) => i.id === id)).toBe(false);
    expect(reviewOf(await cardOf(db, t))).toMatchObject({ group: "needs", why: expect.stringMatching(/^Approved, but 1 photo was rejected/) });
  });

  it("Undo take down refuses while the approved version shows a rejected photo", async () => {
    const { db, t, id } = await setup("a");
    await setPhotoChecks(db, t, id, "a", ALL_CHECKS);
    await reviewSample(db, t, id, "approve", OLU, "", null);
    await rejectPhoto(db, t, id, "a", "");
    await reviewSample(db, t, id, "takedown", OLU, "", null);
    await expect(undoTakedown(db, t, id, OLU)).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/rejected/) });
    expect((await cardOf(db, t)).status).toBe("taken_down");
  });
});

describe("the card", () => {
  const photo = (base: string, over: Partial<ReviewPhoto> = {}): ReviewPhoto => ({ base, file: `${base}.webp`, full: `${base}.webp`, fullAt: "", guest: true, dish: "Galbi", dishSet: true, checks: [], ...over });
  const card = (photoChecks: ReviewPhoto[], over: Partial<SampleCard> = {}): SampleCard => ({
    id: "11111111-2222-4333-8444-555555555555", leadId: "l", business: "Gamma Grill", area: "Astoria, NY", trade: "Restaurant", template: "eat", status: "draft", version: 3,
    draftedAt: "2026-11-22T10:00:00Z", draftedBy: "Site Builder", reviewedBy: "", url: "", hold: false, frozen: false, note: "", leadHref: "/leads/l", kind: "page", changes: "", designReason: "", sources: [],
    open: "/samples/x/preview", pages: [], guestPhotos: [], approvedVersion: null, requests: [], photoChecks, ...over,
  });
  const render = async (c: SampleCard) => {
    const { default: SampleDetail } = await import("@/app/samples/sample-cards");
    return renderToStaticMarkup(createElement(SampleDetail, { c, isOwner: true, backHref: "/samples" }));
  };

  it("names the four rules in one line", () => {
    expect(PHOTO_RULES).toBe("Check each photo: nobody recognisable, no plates, no screen content, no other business's print.");
  });

  it("Send back takes Approve's place, and waits while a photo is undecided", async () => {
    const waiting = await render(card([photo("a", { rejected: true, note: "" }), photo("b")]));
    const bar = waiting.slice(waiting.indexOf("data-decisions"), waiting.indexOf("data-folds"));
    expect(bar).toContain("Send back with 1 rejected photo");
    expect(bar).not.toContain("Approve version");
    expect(bar).toMatch(/<button[^>]*disabled=""[^>]*data-send-back/);
    const ready = await render(card([photo("a", { rejected: true, note: "" }), photo("b", { checks: ALL_CHECKS })]));
    expect(ready).not.toMatch(/<button[^>]*disabled=""[^>]*data-send-back/);
  });

  it("with every photo accepted Approve is on; with one undecided it waits", async () => {
    expect(await render(card([photo("a", { checks: ALL_CHECKS })]))).toMatch(/<button type="button" class="[^"]*">Approve version 3/);
    expect(await render(card([photo("a")]))).toMatch(/<button type="button" disabled=""[^>]*>Approve version 3/);
  });

  it("a request already carrying the photo leaves no second send-back on a sent-back sample", async () => {
    const html = await render(card([photo("a", { rejected: true, note: "", sentOn: 3 })], { status: "changes_requested" }));
    expect(html).not.toContain("data-send-back");
  });
});
