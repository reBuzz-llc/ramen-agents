// A request says who has it; the decisions say what they will really do,
// from the publish rules and the publisher's last visit (when it has not run lately, "publishing is paused", not "goes live");
// extra pages open inside the frame; the wide view in a laptop's frame.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { memoryDb } from "@/lib/db";
import { tenants } from "@/lib/db/schema";
import { decisionMessage, publisherRunning, requestState } from "@/lib/sample-labels";
import { markPublishPoll, type SampleCard } from "@/lib/samples";
import { createTenant } from "@/lib/tenants";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));
const NOW = Date.parse("2026-11-20T13:00:00Z");
const RUNNING = "2026-11-20T12:55:00.000Z";
const STOPPED = "2026-11-14T12:22:00.000Z";
const c = (over: Partial<SampleCard> = {}) => ({ hold: false, url: "", guestPhotos: [], version: 3, ...over });

describe("what a decision will do", () => {
  it("Approve: live within about 10 minutes while the publisher runs (with the guest-photo note), paused otherwise", () => {
    expect(decisionMessage("approve", c(), RUNNING, NOW)).toMatch(/^Approved: it goes up on the publisher's next run \(it last ran \d+ min ago\)\.$/);
    expect(decisionMessage("approve", c({ guestPhotos: [{ name: "a.jpg", dish: "" }, { name: "b.jpg", dish: "" }] }), RUNNING, NOW)).toMatch(/^Approved: it goes up on the publisher's next run \(it last ran \d+ min ago\)\. It shows guests' photos: ask the business to swap them if they mind\.$/);
    expect(decisionMessage("approve", c(), STOPPED, NOW)).toBe("Approved. Publishing to the web is paused on this Mac, so nothing goes live yet.");
    expect(decisionMessage("approve", c(), null, NOW)).toBe("Approved. Publishing to the web is paused on this Mac, so nothing goes live yet.");
    expect(decisionMessage("approve", c({ hold: true }), RUNNING, NOW)).toBe("Approved, but on hold: it stays off the web until someone releases it.");
  });
  it("Take down and Reject say the same truth", () => {
    expect(decisionMessage("takedown", c(), RUNNING, NOW)).toBe("Taken down: it was not on the web.");
    expect(decisionMessage("takedown", c({ url: "https://x.pages.dev/s/" }), RUNNING, NOW)).toMatch(/^Taken down: it comes off the web on the publisher's next run \(it last ran \d+ min ago\)\.$/);
    expect(decisionMessage("takedown", c({ url: "https://x.pages.dev/s/" }), STOPPED, NOW)).toBe("Taken down. Publishing to the web is paused on this Mac, so the page stays on the web until publishing runs again.");
    expect(decisionMessage("reject", c(), RUNNING, NOW)).toBe("Rejected: the Site Builder drops this lead and reads your reason. Nothing was on the web.");
  });
  it("the publisher's visit is recorded by its own read, and counts for 30 minutes", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    await db.update(tenants).set({ settings: { ownPlaces: ["Main St"] } }).where(eq(tenants.id, tenant.id));
    await markPublishPoll(db, tenant.id, new Date(RUNNING));
    const [t] = await db.select({ s: tenants.settings }).from(tenants).where(eq(tenants.id, tenant.id));
    expect(t.s.samplesPublishPolledAt).toBe(RUNNING);
    expect(t.s.ownPlaces).toEqual(["Main St"]);
    expect([publisherRunning(RUNNING, NOW), publisherRunning(STOPPED, NOW), publisherRunning(null, NOW)]).toEqual([true, false, false]);
  });
});

describe("who has a request", () => {
  it("answered, with the site helper (a picture, or the helper's version), or waiting for the Site Builder", () => {
    const r = (o: object) => ({ status: "open", answeredVersion: null, pictures: [] as number[], at: "", ...o });
    expect(requestState(r({ status: "answered", answeredVersion: 19 }), "Site Builder")).toBe("answered by version 19");
    expect(requestState(r({ pictures: [1] }), "Site Builder")).toBe("with the site helper, it has a picture");
    expect(requestState(r({}), "site helper")).toBe("with the site helper");
    expect(requestState(r({}), "Site Builder")).toBe("waiting for the Site Builder");
    expect(requestState(r({ status: "withdrawn" }), "Site Builder")).toBe("withdrawn");
  });
  it("the sample shows each request's state, the paused-publishing line on a live page, and its extra pages inside the frame", async () => {
    const { default: SampleDetail } = await import("@/app/samples/sample-cards");
    const card = {
      id: "11111111-2222-4333-8444-555555555555", leadId: "l", business: "Ssam Tong BBQ", area: "Flushing, NY", trade: "Restaurant", template: "eat", status: "live", version: 19, draftedAt: "2026-11-20T16:42:00Z",
      draftedBy: "Site Builder", reviewedBy: "Owner", url: "https://x.pages.dev/ssam/", hold: false, frozen: false, note: "", leadHref: "/leads/l", kind: "page", changes: "", designReason: "", sources: [], open: "https://x.pages.dev/ssam/",
      pages: [{ name: "gallery", open: "/samples/x/preview?page=gallery" }], guestPhotos: [], approvedVersion: 19,
      requests: [{ id: "r1", text: "Bigger hours", by: "Owner", at: "2026-11-20T16:48:00Z", madeOn: 19, status: "open", answeredVersion: null, pictures: [] }],
    } as SampleCard;
    const html = renderToStaticMarkup(createElement(SampleDetail, { c: card, isOwner: true, backHref: "/samples", publishPolledAt: STOPPED }));
    expect(html).toContain("Publishing to the web is paused on this Mac");
    expect(html).toMatch(/data-page-switch[\s\S]*>Main<[\s\S]*>gallery</);
    expect(html).not.toMatch(/page \(opens in a new tab\)/);
  });
});
