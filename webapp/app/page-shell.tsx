import type { Identity } from "@/lib/identity";
import ProfileMenu from "./profile-menu";
import Wordmark from "./wordmark";

/** The one page width (owner, 10-30: the home page was narrower than the rest). Every page uses it through PageShell. */
const PAGE_WIDTH = "max-w-[1400px]";

/**
 * The frame of every page: a glass toolbar with the wordmark (home) and `left` beside it, the
 * page title in the middle on wide screens, the profile menu on the right; then the page in a main of PAGE_WIDTH.
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
          {title ? <div className="hidden h-11 shrink-0 items-center px-5 text-base font-semibold text-ink sm:flex">{title}</div> : null}
          <div className="flex h-11 min-w-0 flex-1 items-center justify-end">
            <ProfileMenu identity={identity} />
          </div>
        </div>
      </header>
      <main data-shell="main" className={`mx-auto ${PAGE_WIDTH} px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] pb-[calc(env(safe-area-inset-bottom)+2.5rem)] sm:px-6 sm:pb-10`}>
        {children}
      </main>
    </>
  );
}
