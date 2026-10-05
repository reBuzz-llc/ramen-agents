"use client";

import { useEffect, useState } from "react";
import { applyGlass, GLASS_COOKIE, GLASS_DEFAULT } from "@/lib/theme";

function readGlass(): number {
  const m = document.cookie.match(new RegExp(`(?:^|; )${GLASS_COOKIE}=(\\d{1,3})`));
  return m ? Math.min(100, Number(m[1])) : GLASS_DEFAULT;
}

/** Clear ↔ tinted Liquid Glass, with a live preview over colorful content. */
export default function GlassSlider() {
  const [value, setValue] = useState(GLASS_DEFAULT);
  useEffect(() => {
    const t = setTimeout(() => setValue(readGlass()), 0);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="space-y-4">
      <div className="relative h-36 overflow-hidden rounded-xl bg-[radial-gradient(circle_at_20%_30%,#ff9f0a_0,transparent_40%),radial-gradient(circle_at_75%_40%,#bf5af2_0,transparent_45%),radial-gradient(circle_at_50%_90%,#30d158_0,transparent_45%),linear-gradient(135deg,#0a84ff,#5e5ce6)] sm:max-w-lg">
        <div className="absolute inset-x-4 top-4 flex items-center justify-between">
          <span className="glass rounded-full px-3.5 py-2 text-sm font-semibold text-ink">The CEO</span>
          <span className="glass rounded-full px-3.5 py-2 text-sm font-semibold text-bad">Stop</span>
        </div>
        <div className="glass absolute inset-x-8 bottom-4 flex justify-around rounded-full py-2 text-xs font-semibold text-ink">
          <span className="text-accent">Dashboard</span>
          <span>Chat</span>
          <span>Persona</span>
        </div>
      </div>
      <div className="sm:max-w-lg">
        <input
          type="range"
          min={0}
          max={100}
          value={value}
          aria-label="Liquid Glass look"
          aria-valuetext={value < 25 ? "Clear" : value > 75 ? "Tinted" : "Balanced"}
          onChange={(e) => {
            const v = Number(e.target.value);
            setValue(v);
            applyGlass(v);
          }}
          className="h-7 w-full cursor-pointer accent-[var(--sys-blue)]"
        />
        <div className="flex justify-between text-xs font-semibold text-muted">
          <span>Clear</span>
          <button type="button" onClick={() => (setValue(GLASS_DEFAULT), applyGlass(GLASS_DEFAULT))} className="text-accent">
            Default
          </button>
          <span>Tinted</span>
        </div>
      </div>
    </div>
  );
}
