"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BotProfile, BotSummary } from "@/lib/bot";
import { summaryStatus, TONE_DOT, TONE_TEXT, type Tone } from "@/lib/status";
import { useVisibleInterval } from "./hooks";
import { Icon } from "./ui";

// Icon-tile gradients in the system palette, one per bot, so each bot is recognisable at a glance.
const AVATAR_TONES = [
  "from-sys-blue to-sys-indigo",
  "from-sys-teal to-sys-blue",
  "from-sys-orange to-sys-red",
  "from-sys-green to-sys-teal",
  "from-sys-purple to-sys-indigo",
];

function avatarTone(slug: string): string {
  let hash = 0;
  for (const ch of slug) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_TONES[hash % AVATAR_TONES.length];
}

export function Avatar({ bot, size = "md" }: { bot: Pick<BotProfile, "slug" | "handle">; size?: "xs" | "sm" | "md" }) {
  // Four characters (ceoB), so a touch smaller than the two-letter initials it replaces.
  const box = size === "md" ? "h-10 w-10 rounded-[11px] text-[12px]" : size === "sm" ? "h-8 w-8 rounded-[9px] text-[10.5px]" : "h-7 w-7 rounded-full text-[9px]";
  return (
    <span className={`grid shrink-0 place-items-center bg-gradient-to-br font-rounded font-bold tracking-tight text-white ${box} ${avatarTone(bot.slug)}`} aria-hidden>
      {bot.handle}
    </span>
  );
}

// Busiest first: a bot doing something now is the one you want to reach, and a dead data server is the one
// you rarely do. Bots at the same standing keep alphabetical order, so the list does not shuffle about.
const TONE_RANK: Record<Tone, number> = { good: 0, info: 1, warn: 2, bad: 3, muted: 4 };

function byActivity(bots: BotSummary[]): BotSummary[] {
  return [...bots].sort(
    (a, b) => TONE_RANK[summaryStatus(a).tone] - TONE_RANK[summaryStatus(b).tone] || a.name.localeCompare(b.name),
  );
}

/** The bot picker in the glass toolbar. `section` keeps you on the same page (dashboard, chat, persona) when switching. */
export default function BotSwitcher({ current, section = "" }: { current: BotProfile; section?: string }) {
  const [open, setOpen] = useState(false);
  const [bots, setBots] = useState<BotSummary[] | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const href = (slug: string) => `/bots/${slug}${section ? `/${section}` : ""}`;

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bots", { cache: "no-store" });
      if (res.ok) setBots((await res.json()) as BotSummary[]);
    } catch {
      /* keep the last list */
    }
  }, []);

  useVisibleInterval(() => void load(), 10000);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Step through the list as it is shown, wrapping at both ends.
  const ordered = bots ? byActivity(bots) : [];
  const at = ordered.findIndex((b) => b.slug === current.slug);
  const step = (delta: number): BotSummary | null =>
    ordered.length > 1 && at >= 0 ? ordered[(at + delta + ordered.length) % ordered.length] : null;
  const previous = step(-1);
  const next = step(1);
  // This bot's status, shown as a dot on its badge in the closed button (same colours as the menu).
  const mine = bots?.find((b) => b.slug === current.slug);
  const status = mine ? summaryStatus(mine) : null;

  return (
    <div ref={root} className="relative flex min-w-0 items-center gap-1.5">
      {/* Straight to the bot either side of this one, in the order the menu lists them. */}
      <div className="glass flex h-11 shrink-0 items-center rounded-full p-1">
        {([
          ["chevron-left", previous, "Previous"],
          ["chevron-right", next, "Next"],
        ] as const).map(([icon, target, label]) =>
          target ? (
            <Link
              key={label}
              href={href(target.slug)}
              aria-label={`${label} bot: ${target.name}`}
              title={`${label}: ${target.name}`}
              className="pressable grid h-9 w-9 place-items-center rounded-full text-muted transition-colors hover:bg-fill-3 hover:text-ink"
            >
              <Icon name={icon} className="h-4 w-4" />
            </Link>
          ) : (
            <span key={label} aria-hidden className="grid h-9 w-9 place-items-center rounded-full text-muted opacity-30">
              <Icon name={icon} className="h-4 w-4" />
            </span>
          ),
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          void load();
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${current.name}${status ? `, ${status.label}` : ""}. Switch bot`}
        title={status ? `${current.name}: ${status.label}` : undefined}
        className="glass pressable flex h-11 min-w-0 items-center gap-2 rounded-full py-1 pr-3 pl-1.5"
      >
        <span className="relative shrink-0">
          <Avatar bot={current} size="xs" />
          {status ? (
            <span
              aria-hidden
              className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg ${TONE_DOT[status.tone]}`}
            />
          ) : null}
        </span>
        <span className="truncate text-sm font-semibold text-ink">{current.name}</span>
        <Icon name="chevron-down" className={`h-3.5 w-3.5 shrink-0 text-muted transition-transform duration-300 ${open ? "rotate-180" : ""}`} />
      </button>


      {open ? (
        <div
          role="menu"
          className="glass absolute top-full left-0 z-40 mt-2 origin-top-left w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-[1.375rem] p-1.5 [animation:menu-in_0.28s_var(--ease-spring)]"
        >
          <div className="px-3 pt-1.5 pb-1 text-xs font-semibold text-muted">Bots on this Mac</div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {bots === null ? <li className="px-3 py-2.5 text-sm text-muted">Loading…</li> : null}
            {bots?.length === 0 ? <li className="px-3 py-2.5 text-sm text-muted">No bots found in ~/bots.</li> : null}
            {ordered.map((b) => {
              const st = summaryStatus(b);
              const active = b.slug === current.slug;
              return (
                <li key={b.slug}>
                  <Link
                    href={href(b.slug)}
                    role="menuitem"
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`flex items-center gap-3 rounded-[0.875rem] px-2.5 py-2 transition-colors hover:bg-fill-3 ${active ? "bg-fill-3" : ""}`}
                  >
                    <Avatar bot={b} size="sm" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{b.name}</span>
                      <span className={`flex items-center gap-1.5 text-xs ${TONE_TEXT[st.tone]}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[st.tone]}`} />
                        {st.label}
                        <span className="text-muted">· port {b.port}</span>
                      </span>
                    </span>
                    {active ? <Icon name="check" className="h-4 w-4 text-accent" /> : null}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 border-t border-line px-3 pt-2 pb-1.5 text-xs text-muted">
            Add a bot with <code className="font-mono text-2xs">bot new NAME --persona explorer|ceo --port N</code>
          </div>
        </div>
      ) : null}
    </div>
  );
}
