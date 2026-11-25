// Layout A (folds): the decisions always in view, the rows closed by default with their counts
// and warnings in the titles, the live line when an approved version is up while a newer one waits.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SampleCard } from "@/lib/samples";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const card = (over: Partial<SampleCard> = {}): SampleCard => ({
  id: "11111111-2222-4333-8444-555555555555", leadId: "l", business: "Ssam Tong BBQ", area: "Flushing, NY", trade: "Korean barbecue restaurant", template: "eat",
  status: "changes_requested", version: 18, draftedAt: "2026-11-20T16:42:00Z", draftedBy: "site helper", reviewedBy: "Owner", url: "", hold: false, frozen: false,
  note: "", leadHref: "/leads/l", kind: "page", changes: "A gallery page with the grill photos, and the menu's popular dishes first, each with its edited photo and the guests' words.",
  designReason: "", sources: [{ fact: "hours", from: "https://maps.example/x" }], open: "/samples/x/preview", pages: [{ name: "gallery", open: "/samples/x/preview?page=gallery" }],
  guestPhotos: [{ name: "galbi.jpg", dish: "Galbi" }, { name: "eel.jpg", dish: "Eel" }], approvedVersion: 17,
  photoChecks: [{ base: "galbi", file: "galbi.jpg", full: "galbi.jpg", fullAt: "", guest: true, dish: "Galbi", dishSet: true, checks: [] }, { base: "eel", file: "eel.jpg", full: "eel.jpg", fullAt: "", guest: true, dish: "Eel", dishSet: true, checks: [] }],
  requests: [
    { id: "r2", text: "Make the hours bigger on a phone, and move the map up", by: "Owner", at: "2026-11-20T16:48:00Z", madeOn: 18, status: "open", answeredVersion: null, pictures: [1] },
    { id: "r1", text: "Bigger menu photos", by: "Owner", at: "2026-11-20T15:00:00Z", madeOn: 16, status: "answered", answeredVersion: 17, pictures: [] },
  ],
  ...over,
});

async function render(c: SampleCard, isOwner = true, mark: { version: number; family: string; setAt: string; setBy: string } | null = null) {
  const { default: SampleDetail } = await import("@/app/samples/sample-cards");
  return renderToStaticMarkup(createElement(SampleDetail, { c, isOwner, mark, backHref: "/samples" }));
}

describe("the review screen's sample (layout A)", () => {
  it("only Why this design is open by default; the titles carry the counts and warnings", async () => {
    const html = await render(card(), true, { version: 16, family: "eat", setAt: "", setBy: "Owner" });
    expect(html.match(/data-open/g)).toHaveLength(1);
    expect(html).toMatch(/data-fold="why" data-open="true"/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toMatch(/What changed: A gallery page with the grill photos/);
    expect(html).toContain("Photos to check · 2 of 2 left");
    expect(html).toMatch(/Requests · 1 open.*Make the hours bigger/);
    expect(html).toMatch(/Reference · version 16 · Food and drink.*pinned to version 16; now version 17/);
    expect(html).toContain("Why this design · 1 source");
    expect(html).not.toContain("Bigger menu photos");
    expect(html).not.toContain("Stands for");
  });

  it("the decisions and Open site are in view without opening anything; the live line when versions differ; the page at its real size", async () => {
    const html = await render(card());
    const decisions = html.slice(html.indexOf("data-decisions"), html.indexOf("data-folds"));
    expect(decisions).toContain("Request changes");
    expect(decisions).not.toContain("Take down"); // it sits last, under the rows, so a mistaken press is less likely
    expect(html.indexOf("data-takedown-zone")).toBeGreaterThan(html.indexOf("data-folds"));
    expect(html.slice(html.indexOf("data-takedown-zone"))).toContain("Take down");
    expect(decisions).toContain("Open site");
    expect(decisions).not.toContain(">Reject<");
    // a newer version with a request open does not wait for a person
    expect(html).toContain("Approved: version 17 · Version 18, 1 request still open");
    expect(await render(card({ status: "draft", requests: [] }))).toContain("Approved: version 17 · version 18 waits for you");
    expect(html.indexOf("data-decisions")).toBeLessThan(html.indexOf("data-folds"));
    expect(html).toMatch(/data-preview="phone"/);
    expect(html).toMatch(/<iframe[^>]*src="\/api\/samples\/[^"]+\/preview\?v=18&amp;finger=1"/);
    const fresh = await render(card({ status: "draft", version: 1, approvedVersion: null, requests: [], guestPhotos: [], photoChecks: [], changes: "" }), false);
    expect(fresh).toContain(">Approve version 1<");
    expect(fresh).toContain(">Reject<");
    expect(fresh).not.toContain("waits for you");
    expect(fresh).not.toContain("Reference");
    expect(fresh).not.toContain("guest photo");
  });
});

describe("where each sample sits on the list", () => {
  it("drafts need you; sent back or with an open request: the Site Builder; approved or live: up; taken down or rejected: done", async () => {
    const { reviewOf } = await import("@/lib/samples");
    expect(reviewOf(card({ status: "draft", version: 18, requests: [] }))).toEqual({ group: "needs", why: "Version 18 waits for you (version 17 is approved) · 2 guest photos" });
    expect(reviewOf(card({ status: "draft", version: 18 }))).toEqual({ group: "builder", why: "Version 18, 1 request still open" });
    expect(reviewOf(card())).toEqual({ group: "builder", why: "Version 18, 1 request still open" });
    expect(reviewOf(card({ status: "live", url: "https://x.pages.dev/s/", version: 17 }))).toEqual({ group: "builder", why: "1 request open: Make the hours bigger on a phone, and move the map up" });
    expect(reviewOf(card({ status: "live", url: "https://x.pages.dev/s/", requests: [], version: 17 })).group).toBe("up");
    expect(reviewOf(card({ status: "approved", requests: [] })).why).toBe("Approved: publishing is paused, so not live yet");
    expect(reviewOf(card({ status: "approved", requests: [] }), new Date().toISOString()).why).toBe("Approved: it goes up on the publisher's next run (it last ran just now)");
    expect(reviewOf(card({ status: "taken_down" }))).toEqual({ group: "done", why: "Taken down" });
  });
});
