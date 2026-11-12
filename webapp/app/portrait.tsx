"use client";

import { useEffect, useRef } from "react";
import { lookOf, personaRects } from "@/lib/world";
import { drawPortrait } from "./world-draw";

/** The member's portrait in the text box: the same look as in the room, its props included (queue 47). */
export default function Portrait({ slug, grey = false, size = 48 }: { slug: string; grey?: boolean; size?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) drawPortrait(ref.current, lookOf(slug), grey, personaRects(slug, "stand"));
  }, [slug, grey]);
  return <canvas ref={ref} width={96} height={104} style={{ width: (size * 24) / 26, height: size, imageRendering: "pixelated" }} className="shrink-0" aria-hidden />;
}
