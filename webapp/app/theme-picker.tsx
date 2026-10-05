"use client";

import { useEffect, useState } from "react";
import { applyTheme, THEME_COOKIE, type ThemeChoice } from "@/lib/theme";
import { Icon } from "./ui";

const CHOICES: { key: ThemeChoice; label: string; icon: "circle-half" | "sun" | "moon" }[] = [
  { key: "system", label: "Automatic", icon: "circle-half" },
  { key: "light", label: "Light", icon: "sun" },
  { key: "dark", label: "Dark", icon: "moon" },
];

function readChoice(): ThemeChoice {
  const m = document.cookie.match(new RegExp(`(?:^|; )${THEME_COOKIE}=(light|dark|system)`));
  return (m?.[1] as ThemeChoice) ?? "system";
}

/** The current appearance choice, kept in step across every picker on the page. */
export function useThemeChoice(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>("system");
  useEffect(() => {
    const sync = () => setChoice(readChoice());
    sync();
    window.addEventListener("themechange", sync);
    return () => window.removeEventListener("themechange", sync);
  }, []);
  return [choice, (c) => applyTheme(c)];
}

/** A compact segmented control, for the profile menu. */
export function ThemeSegmented() {
  const [choice, choose] = useThemeChoice();
  return (
    <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-1 rounded-full bg-fill-3 p-1">
      {CHOICES.map((c) => {
        const on = c.key === choice;
        return (
          <button
            key={c.key}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => choose(c.key)}
            className={`pressable flex h-8 items-center justify-center gap-1 rounded-full text-xs font-semibold transition-colors ${
              on ? "bg-[var(--seg-thumb)] text-ink shadow-[0_1px_3px_rgb(0_0_0/0.14)]" : "text-muted hover:text-ink"
            }`}
          >
            <Icon name={c.icon} className="h-3.5 w-3.5" />
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

/** Large previews like iOS Settings > Display & Brightness, for the Appearance page. */
export function ThemeCards() {
  const [choice, choose] = useThemeChoice();
  return (
    <div role="radiogroup" aria-label="Appearance" className="grid grid-cols-3 gap-3 sm:max-w-lg">
      {CHOICES.map((c) => {
        const on = c.key === choice;
        const shell =
          c.key === "light"
            ? "bg-[#f2f2f7]"
            : c.key === "dark"
              ? "bg-black"
              : "bg-[linear-gradient(90deg,#f2f2f7_50%,#000_50%)]";
        const card = (dark: boolean) => `${dark ? "bg-[#1c1c1e]" : "bg-white"} rounded-[6px]`;
        return (
          <button key={c.key} type="button" role="radio" aria-checked={on} onClick={() => choose(c.key)} className="pressable group flex flex-col items-center gap-2">
            <span className={`relative block aspect-[3/4] w-full overflow-hidden rounded-2xl ring-offset-2 ring-offset-panel transition ${shell} ${on ? "ring-[3px] ring-sys-blue" : "ring-1 ring-line"}`}>
              <span className="absolute inset-x-[14%] top-[12%] flex flex-col gap-[7%]">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="flex h-4 gap-[8%]">
                    <span className={`h-full flex-1 ${card(c.key === "dark")}`} />
                    {c.key === "system" ? <span className={`h-full flex-1 ${card(true)}`} /> : null}
                  </span>
                ))}
              </span>
              <span className={`absolute inset-x-[22%] bottom-[8%] h-3 rounded-full ${c.key === "dark" ? "bg-white/25" : c.key === "light" ? "bg-black/10" : "bg-sys-gray/40"}`} />
            </span>
            <span className="text-sm font-semibold text-ink">{c.label}</span>
            <span className={`grid h-5 w-5 place-items-center rounded-full ${on ? "bg-sys-blue text-white" : "ring-1 ring-line"}`} aria-hidden>
              {on ? <Icon name="check" className="h-3 w-3" /> : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
