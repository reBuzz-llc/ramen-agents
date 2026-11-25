// The engine's two motion refusals (its tests/test_queue_785.py cases), on Peek's check.
import { describe, expect, it } from "vitest";
import { checkPage } from "@/lib/sample-page";
import { motionProblems } from "@/lib/sample-motion";

const SLIDES = '<div data-slider class="slider"><figure data-slide class="slide">a</figure><figure data-slide class="slide">b</figure></div>';
const page = (css: string) => `<html><head><style>${css}</style></head><body>${SLIDES}</body></html>`;
const full = (css: string) => `<!doctype html><html lang="en"><head><title>G</title><style>${css}</style></head><body><main><h1>Gamma Grill</h1>${SLIDES}</main><footer>Gamma Grill</footer></body></html>`;

describe("a slider hidden with display:none (786)", () => {
  for (const css of ["[data-slide]{display:none}", ".slide{display: none}", ".slider .slide:not(.is-active){display:none}"])
    it(`refuses ${css}`, () => expect(motionProblems(page(css))[0]).toContain("display:none"));
  for (const css of [".slide{opacity:0}.slide.is-active,.slider:not(:has(.is-active)) .slide:first-of-type{opacity:1}", ".slide img{display:none}", "@media print{.slide{display:none}}", ".other{display:none}"])
    it(`passes ${css}`, () => expect(motionProblems(page(css))).toEqual([]));
  it("is nobody's business without a slider", () => expect(motionProblems("<html><head><style>.x{display:none}</style></head><body></body></html>")).toEqual([]));
  it("a class that only starts the same is another class", () => expect(motionProblems(page(".slide-note{display:none}"))).toEqual([]));
});

describe("an animation outside the reduced-motion guard (786)", () => {
  for (const css of [".a{animation:rise 1s}", ".a{animation-name:rise}", "@supports (animation-timeline: view()){.a{animation:rise linear both}}", ".a,.b{animation:rise 1s}@media (prefers-reduced-motion: reduce){.a{animation:none}}"])
    it(`refuses ${css}`, () => expect(motionProblems(page(css))[0]).toContain("reduced-motion guard"));
  for (const css of [
    "@media (prefers-reduced-motion: no-preference){.a{animation:rise 1s}}",
    ".a{animation:rise 1s}@media (prefers-reduced-motion: reduce){.a{animation:none}}",
    ".a{animation:rise 1s}@media (prefers-reduced-motion: reduce){*{animation-duration:0s}}",
    "@media (prefers-reduced-motion: no-preference){@supports (animation-timeline: view()){.a{animation:rise linear both}}}",
    ".a{animation:none}",
    ".a{animation: none}",
    ".btn{transition:transform .3s}",
    ".a:hover{transition:opacity .2s}",
    "@keyframes rise{from{opacity:0}to{opacity:1}}",
  ])
    it(`passes ${css}`, () => expect(motionProblems(page(css))).toEqual([]));
});

describe("on Peek's page check (786)", () => {
  it("refuses a hidden slider and a loose animation, and passes a guarded page", () => {
    const hidden = checkPage(full("[data-slide]{display:none}"), {});
    expect(!hidden.ok && hidden.error).toMatch(/hides its slides/);
    const loose = checkPage(full(".a{animation:rise 1s}"), {});
    expect(!loose.ok && loose.error).toMatch(/reduced-motion guard/);
    expect(checkPage(full("@media (prefers-reduced-motion: no-preference){.a{animation:rise 1s}}.btn{transition:transform .3s}"), {}).ok).toBe(true);
  });
});
