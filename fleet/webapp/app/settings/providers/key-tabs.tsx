"use client";

import { useState } from "react";
import type { BotProfile } from "@/lib/bot";
import { Segmented } from "../../summary-parts";
import FindsView from "./finds-view";
import KeyOverviewView from "./key-overview-view";
import ProvidersView from "./providers-view";
import ReportsView from "./reports-view";

/** Key providers: every key at a glance (Overview), one bot's model chain with keys to save and test (By bot), the
 *  Scout's new finds to test and mark usable or unusable (New finds, owner 2026-11-12), or the usage over a month, three
 *  months, a quarter or a year (Reports). */
export default function KeyTabs({ bots, initial }: { bots: BotProfile[]; initial: string }) {
  const [tab, setTab] = useState<"overview" | "bot" | "finds" | "reports">("overview");
  return (
    <div>
      <div className="mb-5">
        <Segmented<"overview" | "bot" | "finds" | "reports">
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { key: "overview", label: "Overview" },
            { key: "bot", label: "By bot" },
            { key: "finds", label: "Finds" },
            { key: "reports", label: "Reports" },
          ]}
        />
      </div>
      {tab === "overview" ? (
        <KeyOverviewView />
      ) : tab === "finds" ? (
        <FindsView />
      ) : tab === "reports" ? (
        <ReportsView />
      ) : (
        <>
          {/* Most bots share one chain (engine, 2026-10-02): say so, so seven identical lists don't read as seven setups. */}
          <p className="mb-4 rounded-xl bg-sys-blue/10 px-4 py-3 text-sm text-ink">
            The CEO, Lead Gen, Scout and Package Designer share one model chain (common-data/configs/web-bots.toml), so their
            lists here are the same; a bot with its own list shows it. Usage figures are every bot&apos;s together.
          </p>
          <ProvidersView key={initial} bots={bots} initial={initial} />
        </>
      )}
    </div>
  );
}
