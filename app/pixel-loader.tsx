"use client";
// The loading animation, so people can tell the database is still loading: pixelfx's XP orb (vendor/pixelfx, MIT), a small orb racing a figure-eight in the brand orange, beside words
// that say what loads. It waits ~300 ms before it shows (a fast load never flashes it), speaks once through
// role="status", and under reduced motion is the plain words only. One calm effect, no ring.
import { useEffect, useRef, useState } from "react";
import { clearFrame, composite, createFrame, createFx, xpOrb } from "@/vendor/pixelfx/index.js";

/** The brand orange (#ff6600) as the orb's eight steps, dark to white. */
export const ORANGE_RAMP = ["#1a0d00", "#4a2000", "#7a3400", "#c44e00", "#ff6600", "#ff9a4a", "#ffd2b0", "#ffffff"];
/** How long a load runs before the loader shows (ms). */
export const SHOW_AFTER_MS = 300;

/** Whether `ms` have passed since `on` turned true (false again when it turns false). */
function useAfter(on: boolean, ms: number): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!on) return;
    const t = setTimeout(() => setShown(true), ms);
    return () => {
      clearTimeout(t);
      setShown(false);
    };
  }, [on, ms]);
  return on && shown;
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** The orb itself: its own small canvas at the effect's size, drawn crisp at 2x, at 30 frames a second. */
function Orb({ size = 2 }: { size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const c = cv?.getContext("2d");
    if (!cv || !c) return;
    const [w, h] = xpOrb.meta.size ?? [72, 56];
    const [ox, oy] = xpOrb.meta.origin ?? [36, 48];
    cv.width = w;
    cv.height = h;
    const frame = createFrame(w, h);
    const img = new ImageData(w, h);
    const fx = createFx(xpOrb, { x: ox, y: oy, palette: ORANGE_RAMP });
    let raf = 0;
    let last = performance.now();
    let acc = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      acc += dt;
      if (acc >= 1 / 30) {
        fx.update(acc);
        acc = 0;
        clearFrame(frame);
        fx.draw(frame, "front"); // the orb and its tail, without its shadow on a floor
        composite(frame, img.data, null);
        c.putImageData(img, 0, 0);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      fx.stop();
    };
  }, []);
  const [w, h] = xpOrb.meta.size ?? [72, 56];
  return <canvas ref={ref} aria-hidden width={w} height={h} style={{ width: (w * size) / 2, height: (h * size) / 2, imageRendering: "pixelated" }} className="shrink-0" />;
}

/** A loader with its words: shown after SHOW_AFTER_MS while `active`; `inline` is the small one for a row or a button. */
export default function PixelLoader({ label, active = true, inline = false }: { label: string; active?: boolean; inline?: boolean }) {
  const shown = useAfter(active, SHOW_AFTER_MS);
  // read once on the client; the loader renders nothing before its delay, so the server's "false" never shows
  const [still] = useState(prefersReducedMotion);
  if (!shown) return null;
  return (
    <span role="status" aria-live="polite" data-pixel-loader className={`inline-flex items-center ${inline ? "gap-1.5 text-xs" : "gap-3 text-sm"} text-muted`}>
      {still ? null : <Orb size={inline ? 1 : 2} />}
      <span>{label}</span>
    </span>
  );
}
