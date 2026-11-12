import type { Identity } from "@/lib/identity";
import { TabBar, TopNav } from "./app-nav";
import ProfileMenu from "./profile-menu";
import Wordmark from "./wordmark";

/** The one page width (owner, 10-30: the home page was narrower than the rest). Every page uses it through PageShell. */
const PAGE_WIDTH = "max-w-[1400px]";
// Titles the nav already shows as its current place.
const NAV_TITLES = new Set(["Work plan"]);

/**
 * The frame of every page (creatorCC queue 19): a glass toolbar with the wordmark (home) and `left` beside it, the
 * nav in the middle on wide screens (a tab bar along the bottom on phones), the profile menu on the right; then the page in a main of PAGE_WIDTH.
 * No hooks, so server pages and client views both render it.
 */
export default function PageShell({ identity, title, left, children }: { identity: Identity; title?: string; left?: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <header className="pt-safe fixed inset-x-0 top-0 z-30" data-shell="header">
        <div className="scroll-edge-top pointer-events-none absolute inset-x-0 top-0 h-[calc(env(safe-area-inset-top)+5.5rem)]" aria-hidden />
        <div className={`relative mx-auto flex ${PAGE_WIDTH} items-center gap-2 px-3 pt-2 pb-2 sm:px-5`}>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <Wordmark />
            {left}
          </div>
          {/* the app's places (owner, 2026-10-31); a page outside them (Settings) keeps its title here */}
          <TopNav />
          {title && !NAV_TITLES.has(title) ? <div className="hidden h-11 shrink-0 items-center px-3 text-base font-semibold text-ink lg:flex">{title}</div> : null}
          <div className="flex h-11 min-w-0 flex-1 items-center justify-end">
            <ProfileMenu identity={identity} />
          </div>
        </div>
      </header>
      <main data-shell="main" className={`mx-auto ${PAGE_WIDTH} px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] pb-[calc(env(safe-area-inset-bottom)+5.5rem)] sm:px-6 md:pb-10`}>
        {children}
      </main>
      <TabBar />
    </>
  );
}
