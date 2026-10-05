"use client";

import { useState } from "react";
import type { BotProfile } from "@/lib/bot";
import { Segmented } from "../../summary-parts";
import KeyOverviewView from "./key-overview-view";
import ProvidersView from "./providers-view";

/** Key providers: every key at a glance (Overview), or one bot's model chain with keys to save and test (By bot). */
export default function KeyTabs({ bots, initial }: { bots: BotProfile[]; initial: string }) {
  const [tab, setTab] = useState<"overview" | "bot">("overview");
  return (
    <div>
      <div className="mb-5">
        <Segmented<"overview" | "bot">
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { key: "overview", label: "Overview" },
            { key: "bot", label: "By bot" },
          ]}
        />
      </div>
      {tab === "overview" ? (
        <KeyOverviewView />
      ) : (
        <>
          {/* Most bots share one chain (engine, 2026-10-02): say so, so seven identical lists don't read as seven setups. */}
          <p className="mb-4 rounded-xl bg-sys-blue/10 px-4 py-3 text-sm text-ink">
            The CEO, Lead Gen, Scout and Package Designer share one model chain (common-data/configs/web-bots.toml), so their
            lists here are the same; a bot with its own list, like the Desk Agent, shows it. Usage figures are every bot&apos;s together.
          </p>
          <ProvidersView key={initial} bots={bots} initial={initial} />
        </>
      )}
    </div>
  );
}
