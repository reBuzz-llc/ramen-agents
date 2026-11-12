"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { TAB_PATH } from "@/lib/work-plan-rows";
import { Icon } from "./ui";
import { useWorkPlanAttention } from "./work-plan-shortcut";

// The app's nav (owner, 2026-10-31: "a proper nav bar ... remove the check icon ... check Apple's guide"). Apple's tab
// bar guidance: the top-level places, always in view, the current one highlighted, five at most, each with a label.
// Wide screens get it as a floating bar at the top (as iPadOS and macOS place it), phones as a tab bar along the bottom
// with an icon over each label. Settings and notifications stay behind the profile, where Apple puts the account.
type Item = { href: string; label: string; icon: "house" | "checklist" | "clock" | "person-2" | "chart"; full?: boolean };
const ITEMS: Item[] = [
  { href: "/", label: "Home", icon: "house", full: true }, // a full load, as the wordmark: always gets home
  { href: TAB_PATH.plan, label: "Work plan", icon: "checklist" },
  { href: TAB_PATH.past, label: "Past jobs", icon: "clock" },
  { href: TAB_PATH.leads, label: "Leads", icon: "person-2" },
  { href: TAB_PATH.checks, label: "Checks", icon: "chart" },
];

function useNav() {
  const path = (usePathname() ?? "/").replace(/\/$/, "") || "/";
  const att = useWorkPlanAttention();
  return ITEMS.map((it) => {
    const current = path === it.href;
    // the Work plan's red dot: a job finished or stuck, or 3+ steps ticked since the owner last looked
    const dot = it.href === TAB_PATH.plan && att.dot;
    return { ...it, current, dot, label: it.label, aria: dot ? `${it.label}: needs a look (${att.why})` : it.label };
  });
}

function NavLink({ it, className, children }: { it: ReturnType<typeof useNav>[number]; className: string; children: React.ReactNode }) {
  const props = { href: it.href, "aria-current": it.current ? ("page" as const) : undefined, "aria-label": it.aria, title: it.aria, className };
  return it.full ? (
    <a {...props}>{children}</a>
  ) : (
    <Link {...props}>{children}</Link>
  );
}

/** The floating bar in the header, from md up. */
export function TopNav() {
  const items = useNav();
  return (
    <nav aria-label="Main" className="glass hidden h-11 shrink-0 items-center gap-0.5 rounded-full p-1 md:flex">
      {items.map((it) => (
        <NavLink
          key={it.href}
          it={it}
          className={`pressable relative flex h-9 items-center rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors ${it.current ? "bg-[var(--seg-thumb)] text-ink shadow-[0_1px_3px_rgb(0_0_0/0.14)]" : "text-muted hover:text-ink"}`}
        >
          {it.label}
          {it.dot ? <span className="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-sys-red" aria-hidden /> : null}
        </NavLink>
      ))}
    </nav>
  );
}

/** The tab bar along the bottom, below md: an icon over each label, the current one in the tint colour, on an opaque
 *  bar so the page under it never shows through the labels. */
export function TabBar() {
  const items = useNav();
  return (
    <nav aria-label="Main" className="pb-safe fixed inset-x-0 bottom-0 z-30 border-t border-line bg-bg md:hidden">
      <div className="mx-auto grid h-[3.25rem] max-w-lg grid-cols-5">
        {items.map((it) => (
          <NavLink
            key={it.href}
            it={it}
            className={`pressable relative flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium ${it.current ? "text-accent" : "text-muted"}`}
          >
            <span className="relative">
              <Icon name={it.icon} className="h-[22px] w-[22px]" />
              {it.dot ? <span className="absolute -top-0.5 -right-1 h-2.5 w-2.5 rounded-full bg-sys-red ring-2 ring-bg" aria-hidden /> : null}
            </span>
            {it.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
