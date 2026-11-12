import { Suspense } from "react";
import { BOTS_DIR, listBots } from "@/lib/bots";
import { liveBoard } from "@/lib/board-read";
import { currentIdentity } from "@/lib/identity";
import CeoProposals from "./ceo-proposals";
import FamilyBoard from "./family-board";
import HealthBanner from "./health-banner";
import TrialLine from "./trial-line";
import FamilyWeekCard from "./family-week-card";
import OwnerDecisions from "./owner-decisions";
import PageShell from "./page-shell";

export const metadata = { title: "Family · Bot Dashboard" };

// The home page is the live family board (owner, 2026-10-30, creatorCC queue 16): who is working on what, now. The
// board polls /api/board; the boxes above it are server-rendered.
export default async function Home() {
  const [bots, identity] = await Promise.all([listBots(), currentIdentity()]);
  if (!bots.length) {
    return (
      <main className="mx-auto max-w-xl px-4 pt-[calc(env(safe-area-inset-top)+6rem)] pb-24 text-center">
        <h1 className="text-3xl font-bold">No bots yet</h1>
        <p className="mt-2 text-sm text-muted">Nothing with a config.toml was found in {BOTS_DIR}. Create one from the bot checkout:</p>
        <pre className="mt-4 overflow-x-auto rounded-xl bg-panel px-4 py-3 text-left font-mono text-xs">
          .venv/bin/bot new &quot;My Bot&quot; --persona explorer --port 8789
        </pre>
      </main>
    );
  }
  const initial = await liveBoard().catch(() => null);
  return (
    <PageShell identity={identity}>
      {/* queue 55 (owner, 15:50-15:52): no visible heading; the world starts right under the top bar, and the health
          banner, the decisions and the CEO proposals sit below it (or below the List view), at the scene's width */}
      <h1 className="sr-only">Family</h1>
      <FamilyBoard
        initial={initial}
        below={
          // a key on this block: it crosses into the client World as one child among World's own, where React asks for
          // one (queue 405: "Each child in a list should have a unique key ... passed a child from Home")
          <div key="below" className="mt-3 space-y-2">
            <Suspense fallback={null}>
              <TrialLine />
            </Suspense>
            {/* queue 381: the newest "This week in the family" post, under the world and the list view */}
            <Suspense fallback={null}>
              <FamilyWeekCard />
            </Suspense>
            <Suspense fallback={null}>
              <HealthBanner />
            </Suspense>
            <Suspense fallback={null}>
              <OwnerDecisions compact />
            </Suspense>
            <Suspense fallback={null}>
              <CeoProposals compact />
            </Suspense>
          </div>
        }
      />
    </PageShell>
  );
}
