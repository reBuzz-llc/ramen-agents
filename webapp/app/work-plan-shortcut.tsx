"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import type { Attention } from "@/lib/work-plan";
import { useVisibleInterval } from "./hooks";
import { Icon } from "./ui";

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
 * The toolbar shortcut to the Work plan (owner, 2026-09-26), with a red dot when the agents' checklists moved since
 * the owner last looked: a job finished or stuck, or three or more steps ticked.
 */
export default function WorkPlanShortcut() {
  const here = usePathname() === "/work-plan";
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

  const dot = !here && att?.needed;
  const why = att
    ? [
        att.finished.length ? `finished: ${att.finished.join(", ")}` : "",
        att.stuck.length ? `stuck: ${att.stuck.join(", ")}` : "",
        att.ticks ? `${att.ticks} step${att.ticks === 1 ? "" : "s"} ticked` : "",
      ]
        .filter(Boolean)
        .join("; ")
    : "";
  const label = dot ? `Work plan: needs a look (${why})` : "Work plan";

  return (
    <Link
      href="/work-plan"
      aria-label={label}
      title={label}
      aria-current={here ? "page" : undefined}
      className={`glass pressable relative grid h-11 w-11 shrink-0 place-items-center rounded-full ${here ? "text-accent" : "text-ink"}`}
    >
      <Icon name="check" className="h-[18px] w-[18px]" />
      {dot ? <span className="absolute top-1.5 right-1.5 h-2.5 w-2.5 rounded-full bg-sys-red ring-2 ring-bg" aria-hidden /> : null}
    </Link>
  );
}
