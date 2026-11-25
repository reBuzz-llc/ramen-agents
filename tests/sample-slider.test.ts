// The engine's slider gains swipe and arrow keys. Peek allows the new text and the one live pages
// still carry, each by its exact hash, and nothing else as the slider.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkPage, isSliderScript, RULES } from "@/lib/sample-page";

const S = JSON.parse(readFileSync(path.join(__dirname, "fixtures", "slider-scripts.json"), "utf8")) as { previous: string; current: string };
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const page = (...scripts: string[]) =>
  `<!doctype html><html lang="en"><head><title>G</title></head><body><main><h1>Gamma Grill</h1><div data-slider><figure data-slide><blockquote>Lovely.</blockquote></figure><figure data-slide><blockquote>Warm.</blockquote></figure></div></main><footer>Gamma Grill</footer>${scripts.map((s) => `<script>${s}</script>`).join("")}</body></html>`;
const MENU = "document.querySelector('.menu').classList.toggle('open');";

describe("the engine's review slider (785)", () => {
  it("the fixture holds the two texts the rules name", () => {
    expect(sha(S.current)).toBe(RULES.engine_slider_script_sha256);
    expect(sha(S.previous)).toBe(RULES.engine_slider_script_sha256_previous);
    expect(S.current).not.toBe(S.previous);
  });

  it("a page with the previous script passes", () => {
    expect(isSliderScript(S.previous)).toBe(true);
    const r = checkPage(page(S.previous), {});
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });

  it("a page with the current script passes", () => {
    expect(isSliderScript(S.current)).toBe(true);
    const r = checkPage(page(S.current), {});
    expect(r.ok, r.ok ? "" : r.error).toBe(true);
  });

  it("any other text is not the slider: one character, a space, or an added call", () => {
    for (const other of [S.current.replace("6000", "6001"), `${S.current} `, ` ${S.previous}`, `${S.current}fetch('https://example.com');`, ""]) expect(isSliderScript(other)).toBe(false);
  });

  it("a changed slider does not get the slider's place on a page", () => {
    const changed = S.current.replace("6000", "6001");
    const r = checkPage(page(MENU, changed), {});
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/scripts: at most three inline/);
    const net = checkPage(page(`${S.current}fetch('https://example.com');`), {});
    expect(net.ok).toBe(false);
  });

  it("two sliders are refused, even of different versions", () => {
    const r = checkPage(page(S.previous, S.current), {});
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toMatch(/scripts: at most three inline/);
  });
});
