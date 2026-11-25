// The bar reads Clock, Lead, Sample, then a divider, then Package, Asset, File; the labels are singular.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/leads", useRouter: () => ({ refresh: () => {}, push: () => {} }) }));

const who = { name: "A Person", email: "a@test.example", role: "owner", tenantName: "Test Co" };
const bar = async (samples: number | null) => {
  const { default: NavLinks } = await import("@/app/nav-links");
  const html = renderToStaticMarkup(createElement(NavLinks, { who, samples }));
  const end = html.indexOf("</div>");
  const part = html.slice(0, end);
  return { part, labels: [...part.matchAll(/<a [^>]*>([A-Za-z]+)/g)].map((m) => m[1]) };
};

describe("the top bar's order", () => {
  it("an owner or manager: Sample third, the divider, then the rest", async () => {
    const { part, labels } = await bar(3);
    expect(labels).toEqual(["Clock", "Lead", "Sample", "Package", "Asset", "File"]);
    expect(part.indexOf("data-nav-divider")).toBeGreaterThan(part.indexOf('href="/samples"'));
    expect(part.indexOf("data-nav-divider")).toBeLessThan(part.indexOf('href="/packages"'));
    expect(part).toContain('aria-label="Sample: 3 drafts to check"');
  });

  it("a member has no Sample, and the divider stays before the rest", async () => {
    const { part, labels } = await bar(null);
    expect(labels).toEqual(["Clock", "Lead", "Package", "Asset", "File"]);
    expect(part.indexOf("data-nav-divider")).toBeGreaterThan(part.indexOf('href="/leads"'));
    expect(part.indexOf("data-nav-divider")).toBeLessThan(part.indexOf('href="/packages"'));
  });
});
