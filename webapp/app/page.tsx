import { Suspense } from "react";
import { BOTS_DIR, listBots } from "@/lib/bots";
import { liveBoard } from "@/lib/board-read";
import { currentIdentity } from "@/lib/identity";
import CeoProposals from "./ceo-proposals";
import FamilyBoard from "./family-board";
import HealthBanner from "./health-banner";
import OwnerDecisions from "./owner-decisions";
import PageShell from "./page-shell";

export const metadata = { title: "Family · Bot Dashboard" };

// The home page is the live family board (owner, 2026-10-30): who is working on what, now. The
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
      <h1 className="pt-2 text-3xl font-bold text-ink">Family</h1>
      <p className="mt-0.5 text-sm text-muted">Who is working on what, right now. Tap a member to see what they are on.</p>
      <Suspense fallback={null}>
        <HealthBanner className="mt-4" />
      </Suspense>
      <div className="mt-3 space-y-2">
        <Suspense fallback={null}>
          <OwnerDecisions compact />
        </Suspense>
        <Suspense fallback={null}>
          <CeoProposals compact />
        </Suspense>
      </div>
      <FamilyBoard initial={initial} />
    </PageShell>
  );
}
