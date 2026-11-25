"use client";

import { useState } from "react";

/** "The owner changed the daily goals to …": once per change, until this person dismisses it. */
export default function GoalsBanner({ at, text }: { at: string; text: string }) {
  const [gone, setGone] = useState(false);
  if (gone) return null;
  return (
    <p role="status" data-goals-changed className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-accent bg-accent-tint px-4 py-2.5 text-sm">
      <span>{text}</span>
      <button
        type="button"
        onClick={() => {
          setGone(true);
          void fetch("/api/view-prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ goals_seen: at }) }).catch(() => undefined);
        }}
        className="-my-1 inline-flex min-h-9 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-accent-ink hover:bg-accent/10"
      >
        Dismiss
      </button>
    </p>
  );
}
