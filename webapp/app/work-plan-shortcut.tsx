"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Attention } from "@/lib/work-plan";
import { tabOfPath } from "@/lib/work-plan-rows";
import { useVisibleInterval } from "./hooks";

const SEEN_KEY = "workplan-seen";

/** Local time without an offset, the way the engine stamps plan.json ("2026-09-26T18:40:12"). */
function localStamp(ms: number): string {
  return new Date(ms - new Date(ms).getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}

function readSeen(): string {
  try {
    return localStorage.getItem(SEEN_KEY) ?? localStamp(Date.now() - 24 * 3600e3);
  } catch {
    return localStamp(Date.now() - 24 * 3600e3);
  }
}

/** Mark the Work plan as looked at now (the page calls this while it is open), which clears the red dot. */
export function markWorkPlanSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, localStamp(Date.now()));
  } catch {
    /* private window: the dot just clears less often */
  }
  window.dispatchEvent(new Event("workplanseen"));
}

/**
 * What moved on the agents' checklists since the owner last looked (owner, 2026-09-26): a job finished or stuck, or
 * three or more steps ticked. The nav's Work plan tab shows it as a red dot (2026-10-31: the check icon is gone).
 */
export function useWorkPlanAttention(): { dot: boolean; why: string } {
  const here = tabOfPath(usePathname()) !== null; // any of its pages
  const [att, setAtt] = useState<Attention | null>(null);
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/work-plan?since=${encodeURIComponent(readSeen())}`, { cache: "no-store" });
      if (res.ok) setAtt((await res.json()) as Attention);
    } catch {
      /* keep the last answer */
    }
  }, []);
  useVisibleInterval(() => void load(), 60000);
  useEffect(() => {
    const again = () => void load();
    window.addEventListener("workplanseen", again);
    return () => window.removeEventListener("workplanseen", again);
  }, [load]);

  const dot: boolean = !here && !!att?.needed;
  const why = att
    ? [
        att.finished.length ? `finished: ${att.finished.join(", ")}` : "",
        att.stuck.length ? `stuck: ${att.stuck.join(", ")}` : "",
        att.ticks ? `${att.ticks} step${att.ticks === 1 ? "" : "s"} ticked` : "",
      ]
        .filter(Boolean)
        .join("; ")
    : "";
  return { dot, why };
}
