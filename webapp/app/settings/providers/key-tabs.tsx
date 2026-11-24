"use client";

import { useState } from "react";
import { Segmented } from "../../summary-parts";
import AllProvidersView from "./all-providers-view";
import FindsView from "./finds-view";
import KeyOverviewView from "./key-overview-view";
import ReportsView from "./reports-view";

/** Key providers: every key on this Mac at a glance (Overview), every provider ramen-agents knows with Add key, Test,
 *  Delete and your own mark (All providers, from common-data/providers.json), the Scout's new finds (Finds), or the usage
 *  over a month, three months, a quarter or a year (Reports). The members share one chain, so there is no per-bot view. */
export default function KeyTabs() {
  const [tab, setTab] = useState<"overview" | "all" | "finds" | "reports">("all");
  return (
    <div>
      <div className="mb-5">
        <Segmented<"overview" | "all" | "finds" | "reports">
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { key: "all", label: "All providers" },
            { key: "overview", label: "Overview" },
            { key: "finds", label: "Finds" },
            { key: "reports", label: "Reports" },
          ]}
        />
      </div>
      {tab === "overview" ? <KeyOverviewView /> : tab === "finds" ? <FindsView /> : tab === "reports" ? <ReportsView /> : <AllProvidersView />}
    </div>
  );
}
