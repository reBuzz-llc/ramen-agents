// The loading animation: pixelfx's XP orb, vendored under its MIT licence, one effect only; brand
// orange; shown after ~300 ms; role="status" with words; plain words under reduced motion.
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("the loading orb", () => {
  it("carries pixelfx's MIT licence and notice, and only one effect", () => {
    expect(read("vendor/pixelfx/LICENSE")).toMatch(/^MIT License/);
    expect(existsSync(path.join(root, "vendor/pixelfx/NOTICE.md"))).toBe(true);
    expect(readdirSync(path.join(root, "vendor/pixelfx/src/fx"))).toEqual(["pickups"]);
    expect(readdirSync(path.join(root, "vendor/pixelfx/src/fx/pickups")).sort()).toEqual(["_lib.js", "xp-orb.js"]);
  });

  it("is brand orange, waits 300 ms, speaks as a status with words, and is words only under reduced motion", () => {
    const src = read("app/pixel-loader.tsx");
    expect(src).toMatch(/ORANGE_RAMP = \[[^\]]*"#ff6600"/);
    expect(src).toMatch(/SHOW_AFTER_MS = 300;/);
    expect(src).toMatch(/role="status"/);
    expect(src).toMatch(/prefers-reduced-motion: reduce/);
    expect(src).toMatch(/\{still \? null : <Orb/);
  });

  it("runs the orb itself", async () => {
    const { clearFrame, composite, createFrame, createFx, xpOrb } = await import("@/vendor/pixelfx/index.js");
    const [w, h] = xpOrb.meta.size!;
    const f = createFrame(w, h);
    const fx = createFx(xpOrb, { x: 36, y: 48, palette: ["#1a0d00", "#4a2000", "#7a3400", "#c44e00", "#ff6600", "#ff9a4a", "#ffd2b0", "#ffffff"] });
    fx.update(0.5);
    clearFrame(f);
    fx.draw(f, "front");
    const out = composite(f, new Uint8ClampedArray(w * h * 4), null);
    let lit = 0;
    for (let i = 3; i < out.length; i += 4) if (out[i] > 0) lit++;
    expect(lit).toBeGreaterThan(20); // the orb and its tail are drawn
  });

  it("is on the leads' loading screen, its tabs, its rows and its saves", () => {
    expect(read("app/leads/loading.tsx")).toMatch(/Loading the leads from the database/);
    const v = read("app/leads/leads-view.tsx");
    expect(v).toMatch(/pendingTab === "table" \? "Loading every cell of every lead…"/);
    expect(v).toMatch(/PixelLoader inline active=\{busy\} label="Saving to the database…"/);
    expect(v).toMatch(/PixelLoader inline active=\{!!busy\}/);
  });
});
