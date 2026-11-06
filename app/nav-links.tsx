"use client";
// The top bar: the daily work on the left (Clock, Our queue, Leads), everything else in the profile menu on the
// right. The page you are on is marked: accent text, the brand orange underline and aria-current="page" in the bar; a
// filled row in the menu, and a ring on the profile button while you are on one of its pages. Below 380 px the wordmark
// steps aside (Clock is home) and, with large text, the links scroll inside the bar, so the page never scrolls sideways.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import SignOut from "./sign-out";

/** The bar: the work people do every day. */
export const NAV = [
  { href: "/", label: "Clock" },
  { href: "/queue", label: "Our queue" },
  { href: "/leads", label: "Leads" },
  { href: "/files", label: "Files" },
  { href: "/asset", label: "Asset" }, // what we sell: rates and packages
] as const;
/** The profile menu: looking back and setting up. */
export const MENU = [
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/week", label: "This week" },
  { href: "/guide", label: "Guide" }, // the team's step-by-step guide
  { href: "/settings", label: "Settings" },
  { href: "/privacy", label: "Privacy" },
] as const;

/** The nav item a path belongs to: "/" only for home itself, the others for their pages and everything under them. */
export function currentNav(path: string): string | null {
  if (path === "/" || path === "/clock" || path.startsWith("/projects/")) return "/";
  const hit = [...NAV, ...MENU].filter((n) => n.href !== "/").find((n) => path === n.href || path.startsWith(`${n.href}/`));
  return hit ? hit.href : null;
}

export default function NavLinks({ who }: { who: { name: string; email: string; role: string; tenantName: string } }) {
  const current = currentNav(usePathname() ?? "/");
  const links = useRef<HTMLDivElement>(null);
  // When the links scroll inside the bar, the current one is brought into view.
  useEffect(() => {
    links.current?.querySelector<HTMLElement>("[aria-current=page]")?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [current]);
  return (
    <>
      <div ref={links} className="-mb-px flex min-w-0 items-center gap-x-3 max-[379px]:gap-x-2.5 overflow-x-auto [scrollbar-width:none] sm:gap-x-5">
        {NAV.map((n) => {
          const on = current === n.href;
          return (
            <Link
              key={n.href}
              href={n.href}
              aria-current={on ? "page" : undefined}
              className={`inline-flex min-h-12 shrink-0 items-center border-b-2 whitespace-nowrap ${on ? "border-accent font-semibold text-accent-ink" : "border-transparent text-muted hover:text-ink"}`}
            >
              {n.label}
            </Link>
          );
        })}
      </div>
      <ProfileMenu who={who} current={current} />
    </>
  );
}

function ProfileMenu({ who, current }: { who: { name: string; email: string; role: string; tenantName: string }; current: string | null }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const name = who.name || who.email;
  const initials = name
    .split(/[\s@.]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");
  const inMenu = MENU.some((m) => m.href === current);
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("pointerdown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  return (
    <div ref={box} className="relative ml-auto shrink-0">
      <button
        ref={button}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${name}: menu`}
        onClick={() => setOpen(!open)}
        className={`flex min-h-11 items-center gap-2 rounded-full py-1 pr-2 pl-1 hover:bg-bg ${inMenu ? "ring-2 ring-accent/60" : ""}`}
      >
        <span aria-hidden className="inline-flex size-8 items-center justify-center rounded-full bg-accent text-xs font-bold text-on-accent">
          {initials || "?"}
        </span>
        <span className="hidden max-w-32 truncate text-sm text-ink sm:inline">{name}</span>
        <svg width={12} height={12} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" aria-hidden className={`text-muted transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      {open ? (
        <div role="menu" className="absolute right-0 z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] origin-top-right rounded-2xl border border-line bg-panel p-1.5 shadow-xl motion-safe:animate-[menu-in_120ms_ease-out]">
          <div className="px-3 py-2">
            <p className="truncate font-semibold">{name}</p>
            <p className="truncate text-xs text-muted">
              {who.role} · {who.tenantName}
            </p>
          </div>
          <div className="my-1 border-t border-line" />
          {MENU.map((m) => {
            const on = current === m.href;
            return (
              <Link
                key={m.href}
                href={m.href}
                role="menuitem"
                aria-current={on ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`flex min-h-11 items-center justify-between rounded-xl px-3 text-sm ${on ? "bg-accent-tint font-semibold text-accent-ink" : "text-ink hover:bg-bg"}`}
              >
                {m.label}
                {on ? <span aria-hidden>•</span> : null}
              </Link>
            );
          })}
          <div className="my-1 border-t border-line" />
          <SignOut className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm text-bad hover:bg-bg" />
        </div>
      ) : null}
    </div>
  );
}
