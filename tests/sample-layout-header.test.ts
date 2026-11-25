// On /samples the preview moves up and stays in view. On a computer in the phone view the
// header sits in the left column with the decisions and rows, and the page starts at the top on the right and stays in
// view; on a phone the order stays header, page, decisions.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SampleCard } from "@/lib/samples";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

describe("the preview beside the header (11-21)", () => {
  it("one grid: the header first, the page spanning from the top on the right, sticky; the rows under the header", async () => {
    const { default: SampleDetail } = await import("@/app/samples/sample-cards");
    const card = {
      id: "11111111-2222-4333-8444-555555555558", leadId: "l", business: "Curioni's Pizza", area: "Lodi, NJ", trade: "Pizza restaurant", template: "eat", status: "changes_requested", version: 6,
      draftedAt: "2026-11-21T10:55:00Z", draftedBy: "site helper", reviewedBy: "Owner", url: "", hold: false, frozen: false, note: "", leadHref: "/leads/l", kind: "page", changes: "", designReason: "",
      sources: [], open: "/samples/x/preview", pages: [], guestPhotos: [], approvedVersion: 3, requests: [],
    } as SampleCard;
    const html = renderToStaticMarkup(createElement(SampleDetail, { c: card, isOwner: true, backHref: "/samples", publishPolledAt: "" }));
    const grid = html.indexOf("lg:grid-rows-[auto_1fr]");
    const header = html.indexOf("<header");
    const preview = html.indexOf("data-preview-column");
    expect(grid).toBeGreaterThan(-1);
    expect(header).toBeGreaterThan(grid);
    expect(html.slice(header, header + 200)).toMatch(/order-1 min-w-0 lg:col-start-1 lg:row-start-1/);
    expect(html).toMatch(/class="order-2 min-w-0 lg:sticky lg:top-4 lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start" data-preview-column/);
    expect(html).toMatch(/class="order-3 min-w-0 lg:order-none lg:col-start-1 lg:row-start-2"/);
    expect(preview).toBeGreaterThan(header);
  });
});
