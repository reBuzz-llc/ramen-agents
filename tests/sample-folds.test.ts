// On /samples, the Why this design row is open when a sample is opened; the rows act as one group,
// opening one closes the rest; the browser's memory per sample follows the same rule.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { foldToggle, foldsFrom } from "@/lib/sample-labels";
import type { SampleCard } from "@/lib/samples";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

describe("692: one open row on a sample", () => {
  it("a sample never seen opens with Why this design; the memory keeps at most one row", () => {
    expect(foldsFrom(null)).toEqual(["why"]);
    expect(foldsFrom("[]")).toEqual([]);
    expect(foldsFrom('["changes"]')).toEqual(["changes"]);
    expect(foldsFrom('["changes","requests"]')).toEqual(["requests"]);   // an older memory with several: the last opened
    expect(foldsFrom("not json")).toEqual(["why"]);
  });
  it("opening a row closes the open one, Why this design included; closing the open row leaves all closed", () => {
    expect(foldToggle(["why"], "changes")).toEqual(["changes"]);
    expect(foldToggle(["changes"], "requests")).toEqual(["requests"]);
    expect(foldToggle(["requests"], "requests")).toEqual([]);
    expect(foldToggle([], "why")).toEqual(["why"]);
  });
  it("the sample renders with Why this design open and the other rows closed", async () => {
    const { default: SampleDetail } = await import("@/app/samples/sample-cards");
    const card = {
      id: "11111111-2222-4333-8444-555555555556", leadId: "l", business: "Ssam Tong BBQ", area: "Flushing, NY", trade: "Restaurant", template: "eat", status: "draft", version: 20, draftedAt: "2026-11-20T16:42:00Z",
      draftedBy: "Site Builder", reviewedBy: "", url: "", hold: false, frozen: false, note: "", leadHref: "/leads/l", kind: "page", changes: "Bigger opening hours line", designReason: "Dark grill tones for a BBQ house",
      sources: [], open: "/samples/x/preview", pages: [], guestPhotos: [], approvedVersion: 19,
      requests: [{ id: "r1", text: "Bigger hours", by: "Owner", at: "2026-11-20T16:48:00Z", madeOn: 19, status: "answered", answeredVersion: 20, pictures: [] }],
    } as SampleCard;
    const html = renderToStaticMarkup(createElement(SampleDetail, { c: card, isOwner: true, backHref: "/samples", publishPolledAt: "" }));
    expect(html).toMatch(/data-fold="why" data-open="true"/);
    expect(html).toContain("Dark grill tones for a BBQ house");
    expect(html.match(/data-open="true"/g)).toHaveLength(1);
    expect(html).toMatch(/data-fold="changes"(?! data-open)/);
  });
});
