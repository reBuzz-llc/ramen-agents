"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useContext, useEffect, useState } from "react";
import type { BotProfile } from "@/lib/bot";
import BotSwitcher from "./bot-switcher";
import ProfileMenu from "./profile-menu";
import type { Identity } from "@/lib/identity";
import { BOT_PAGE_COOKIE } from "@/lib/view-prefs";
import { Icon } from "./ui";

export type Section = "" | "summary" | "chat" | "persona";
/** Dashboard sub-pages: they keep the Dashboard tab lit, and switching bots stays on them. */
const SUB_PAGES = ["screenshots", "visits"];

const SECTIONS: { key: Section; label: string; icon: "gauge" | "chart" | "chat" | "person" }[] = [
  { key: "", label: "Dashboard", icon: "gauge" },
  { key: "summary", label: "Summary", icon: "chart" },
  { key: "chat", label: "Chat", icon: "chat" },
  { key: "persona", label: "Persona", icon: "person" },
];

/** Where a page puts its toolbar actions (Run/Stop, Save): a slot in the persistent toolbar. */
const ActionsSlot = createContext<HTMLElement | null>(null);
export const useActionsSlot = () => useContext(ActionsSlot);

export const PAGE_WIDTH = "max-w-[1400px]";

/**
 * The navigation layer (applebrandkit.md), rendered once by app/bots/[slug]/layout.tsx and kept mounted
 * while you move between Dashboard, Chat and Persona. Only the page underneath changes, so the toolbar,
 * the bot list it loaded, and the tab bar never flicker or shift. Pages add their actions through
 * useActionsSlot (see AppChrome).
 */
export default function ChromeShell({ bot, identity, children }: { bot: BotProfile; identity: Identity; children: React.ReactNode }) {
  const pathname = usePathname();
  const rest = pathname.split(`/bots/${bot.slug}`)[1] ?? "";
  const section: Section = rest.startsWith("/summary") ? "summary" : rest.startsWith("/chat") ? "chat" : rest.startsWith("/persona") ? "persona" : "";
  // Switching bots keeps you where you are, including on a sub-page such as /screenshots.
  const sub = SUB_PAGES.find((p) => rest.startsWith(`/${p}`));
  const stay = sub ?? section;
  const href = (key: Section) => `/bots/${bot.slug}${key ? `/${key}` : ""}`;
  // Remember the bot and the page, so Back from Settings, the chatroom or Requests lands here again.
  useEffect(() => {
    document.cookie = `bot=${bot.slug}; path=/; max-age=31536000; samesite=lax`;
    document.cookie = `${BOT_PAGE_COOKIE}=${stay}; path=/; max-age=31536000; samesite=lax`;
  }, [bot.slug, stay]);
  // A callback ref stored in state: pages rendered after it attaches portal their actions straight in.
  const [slot, setSlot] = useState<HTMLElement | null>(null);

  return (
    <ActionsSlot.Provider value={slot}>
      <header className="pt-safe fixed inset-x-0 top-0 z-30">
        <div className="scroll-edge-top pointer-events-none absolute inset-x-0 top-0 h-[calc(env(safe-area-inset-top)+5.5rem)]" aria-hidden />
        <div className={`relative mx-auto flex ${PAGE_WIDTH} items-center gap-2 px-3 pt-2 pb-2 sm:px-5`}>
          <div className="min-w-0 flex-1">
            <BotSwitcher current={bot} section={stay} />
          </div>
          <nav aria-label="Sections" className="glass hidden shrink-0 items-center rounded-full p-1 sm:flex">
            {SECTIONS.map((s) => {
              const active = s.key === section;
              return (
                <Link
                  key={s.label}
                  href={href(s.key)}
                  aria-current={active ? "page" : undefined}
                  className={`pressable flex h-9 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors ${
                    active ? "bg-panel text-ink shadow-[0_1px_4px_rgb(0_0_0/0.12)]" : "text-muted hover:text-ink"
                  }`}
                >
                  <Icon name={s.icon} className="h-4 w-4" />
                  {s.label}
                </Link>
              );
            })}
          </nav>
          {/* Same height on every page, filled or not, so the bar never changes size. */}
          <div className="flex h-11 min-w-0 flex-1 items-center justify-end gap-2">
            <div ref={setSlot} className="flex min-w-0 items-center justify-end gap-2" />
            <ProfileMenu identity={identity} />
          </div>
        </div>
      </header>

      {children}

      <div className="pb-safe fixed inset-x-0 bottom-0 z-30 sm:hidden">
        <div className="scroll-edge-bottom pointer-events-none absolute inset-x-0 bottom-0 h-[calc(env(safe-area-inset-bottom)+6rem)]" aria-hidden />
        <nav aria-label="Sections" className="glass relative mx-4 mb-2 flex items-stretch justify-around rounded-full p-1">
          {SECTIONS.map((s) => {
            const active = s.key === section;
            return (
              <Link
                key={s.label}
                href={href(s.key)}
                aria-current={active ? "page" : undefined}
                className={`pressable flex h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-2xs font-semibold transition-colors ${
                  active ? "bg-fill-3 text-accent" : "text-ink"
                }`}
              >
                <Icon name={s.icon} className="h-6 w-6" />
                {s.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </ActionsSlot.Provider>
  );
}
