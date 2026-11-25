// No gap above the preview: it starts level with the page title, sticks
// 16 px from the window, shows a true 390 px page, and the Reference row says which version it will mark.
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SampleCard } from "@/lib/samples";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const card = (over: Partial<SampleCard> = {}) =>
  ({
    id: "11111111-2222-4333-8444-555555555559", leadId: "l", business: "A Test Cafe", area: "Queens, NY", trade: "Cafe", template: "eat", status: "changes_requested", version: 23,
    draftedAt: "2026-11-21T10:55:00Z", draftedBy: "Site Builder", reviewedBy: "Owner", url: "", hold: false, frozen: false, note: "", leadHref: "/leads/l", kind: "page", changes: "",
    designReason: "", sources: [], open: "/samples/x/preview", pages: [{ name: "gallery", open: "/samples/x/preview?page=gallery" }], guestPhotos: [], approvedVersion: 19, requests: [],
    ...over,
  }) as SampleCard;
const render = async (over: Partial<SampleCard> = {}, mark: unknown = null) => {
  const { default: SampleDetail } = await import("@/app/samples/sample-cards");
  return renderToStaticMarkup(createElement(SampleDetail, { c: card(over), isOwner: true, canMark: true, mark: mark as never, backHref: "/samples", publishPolledAt: "" }));
};

describe("the preview's place and width", () => {
  it("a true 390 px: a 410 px frame with 10 px borders, in a column of the same width", async () => {
    const html = await render();
    expect(html).toMatch(/data-preview="phone"/);
    expect(html).toMatch(/max-w-\[24\.5rem\] md:w-\[25\.625rem\] md:max-w-none[\s\S]*?class="w-full [^"]*border-\[10px\][^"]*" data-preview="phone"/);
    expect(html).toContain("lg:grid-cols-[minmax(0,1fr)_25.625rem]");
  });

  it("sticks 16 px from the window with the whole frame in view", async () => {
    const html = await render();
    expect(html).toContain("lg:sticky lg:top-4");
    expect(html).toContain("lg:h-[min(52.75rem,calc(100vh-2rem-20px-3.375rem))]");
  });

  it("the switches sit directly above the preview frame, once, and the header block ends with the buttons", async () => {
    const html = await render();
    const bar = html.indexOf("data-preview-switches");
    expect(bar).toBeGreaterThan(html.indexOf("data-preview-column"));
    expect(bar).toBeLessThan(html.indexOf('data-preview="phone"'));
    expect(bar).toBeGreaterThan(html.indexOf("data-decisions"));
    expect(html.match(/data-preview-switches/g)).toHaveLength(1);
    expect(html.match(/aria-label="Preview size"/g)).toHaveLength(1);
  });

  it("the title sits over the list on a computer, and the sample starts level with it", () => {
    const src = readFileSync(`${process.cwd()}/app/samples/page.tsx`, "utf8");
    expect(src).toContain("lg:col-span-1 lg:col-start-1 lg:row-start-1");
    expect(src).toContain("md:top-4 md:max-h-[calc(100vh-2rem)]");
    expect(src).toContain("lg:col-start-2 lg:row-span-2 lg:row-start-1");
  });
});

describe("the Reference row names its version", () => {
  it("with a newer draft: the title, the switch and one line all say so", async () => {
    const html = await render();
    expect(html).toContain("Reference site: would mark approved version 19");
    expect(html).toContain('aria-label="Reference site: would mark approved version 19"');
  });

  it("with no newer draft, or with a mark set, it stays as it was", async () => {
    const same = await render({ status: "approved", version: 19 });
    expect(same).not.toContain("would mark");
    expect(same).toContain('aria-label="Reference site"');
    const marked = await render({}, { version: 19, family: "eat", setAt: "2026-11-21T10:00:00Z", setBy: "Owner" });
    expect(marked).not.toContain("would mark");
  });
});
