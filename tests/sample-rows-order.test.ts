// The sample's rows read Reference, Requests, What changed, Why this design, the photo swap; Open lead sits on
// the right of Open site, in the same style.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SampleCard } from "@/lib/samples";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const card = (over: Partial<SampleCard> = {}) =>
  ({
    id: "11111111-2222-4333-8444-555555555560", leadId: "l", business: "A Test Cafe", area: "Queens, NY", trade: "Cafe", template: "eat", status: "draft", version: 3,
    draftedAt: "2026-11-21T10:55:00Z", draftedBy: "Site Builder", reviewedBy: "", url: "", hold: false, frozen: false, note: "", leadHref: "/leads?lead=l", kind: "page", changes: "A change",
    designReason: "Why", sources: [{ fact: "hours", from: "https://maps.example/x" }], open: "/samples/x/preview", pages: [], guestPhotos: [{ name: "a.webp", dish: "Dish" }], approvedVersion: 2,
    photoChecks: [{ base: "a", file: "a.webp", guest: true, dish: "Dish", checks: [] }],
    requests: [{ id: "r", text: "Please change", by: "Owner", at: "2026-11-21T10:00:00Z", madeOn: 2, status: "open", answeredVersion: null, pictures: [] }],
    ...over,
  }) as SampleCard;
const render = async (over: Partial<SampleCard> = {}, isOwner = true) => {
  const { default: SampleDetail } = await import("@/app/samples/sample-cards");
  return renderToStaticMarkup(createElement(SampleDetail, { c: card(over), isOwner, canMark: true, backHref: "/samples", publishPolledAt: "" }));
};

describe("the sample's rows and links", () => {
  it("the rows are in the owner's order", async () => {
    const html = await render();
    expect([...html.matchAll(/data-fold="([a-z]+)"/g)].map((m) => m[1])).toEqual(["reference", "requests", "changes", "why", "photos"]);
  });

  it("Open lead is on the right of Open site, as the same kind of button", async () => {
    const html = await render();
    const site = html.indexOf("Open site");
    const lead = html.indexOf("data-lead-link");
    expect(site).toBeGreaterThan(-1);
    expect(lead).toBeGreaterThan(site);
    expect(lead).toBeLessThan(html.indexOf("data-folds"));
    expect(html.match(/Open lead/g)).toHaveLength(1);
    expect(html.slice(html.indexOf("data-site-links"), html.indexOf("data-folds"))).toMatch(/Open site[\s\S]*Open lead/);
    expect(html).toMatch(/inline-flex shrink-0 items-center gap-2" data-site-links/);
    const cls = (at: number) => html.slice(html.lastIndexOf("<a ", at), html.indexOf(">", at)).match(/class="([^"]+)"/)?.[1];
    expect(cls(lead)).toBe(cls(site));
  });

  it("a taken-down sample has it there too, before Delete", async () => {
    const html = await render({ status: "taken_down" });
    expect(html.indexOf("data-lead-link")).toBeGreaterThan(html.indexOf("Open site"));
    expect(html.indexOf("data-lead-link")).toBeLessThan(html.indexOf("data-delete-sample"));
  });
});
