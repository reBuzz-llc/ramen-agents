import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { withFinger } from "@/lib/sample-finger";
import { pageCsp } from "@/lib/sample-page";

const PAGE = `<!doctype html><html><head><title>x</title></head><body><a href="?page=gallery&v=3">Gallery</a><a href="?">Home</a><a href="https://maps.example/?q=1">Map</a><script>menu()</script></body></html>`;
const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");

describe("withFinger (the Phone preview's mouse as a finger)", () => {
  it("adds its style and one script before the last </body>", () => {
    const out = withFinger(PAGE, "page");
    expect(out.match(/<script>/g)).toHaveLength(2);
    expect(out.indexOf("data-peek-finger")).toBeGreaterThan(out.indexOf("menu()"));
    expect(out.endsWith("</body></html>")).toBe(true);
  });

  it("keeps finger mode on the links between pages and leaves other links alone", () => {
    const out = withFinger(PAGE, "page");
    expect(out).toContain('href="?page=gallery&v=3&finger=1"');
    expect(out).toContain('href="?finger=1"');
    expect(out).toContain('href="https://maps.example/?q=1"');
  });

  it("runs under the page's own CSP, by hash, with connect and forms still shut", () => {
    const out = withFinger(PAGE, "page");
    const added = [...out.matchAll(/<script>([\s\S]*?)<\/script>/g)].pop()![1];
    const csp = pageCsp(out, "page");
    expect(csp).toContain(`'sha256-${createHash("sha256").update(added, "utf8").digest("base64")}'`);
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("form-action 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it("leaves a template page, which allows no script, as it is", () => {
    expect(withFinger(PAGE, "template")).toBe(PAGE);
  });

  it("a page with no </body> still gets it", () => {
    expect(withFinger("<p>x</p>", "page")).toContain("data-peek-finger");
  });

  it("is only on the Phone preview: not Wide, and not the Open site route", () => {
    const cards = read("app/samples/sample-cards.tsx");
    const phone = cards.slice(cards.indexOf('data-preview="phone"'), cards.indexOf('data-preview="wide"'));
    const wide = cards.slice(cards.indexOf('data-preview="wide"'), cards.indexOf('data-preview="wide"') + 700);
    expect(phone).toContain("finger=1");
    expect(wide).not.toContain("finger=1");
    expect(read("app/samples/[id]/preview/route.ts")).not.toContain("withFinger");
  });
});
