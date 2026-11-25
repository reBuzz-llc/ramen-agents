"use client";

import { usePathname } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

// The count on the Follow up tab and the Leads link. Read after the page is up, so it never slows a page.
// Moving between pages asks at most once in FRESH_MS. A mark or a result still asks at once (refreshFollowUpCount).
const FRESH_MS = 30_000;
let count = 0;
let askedAt = 0;
let asking: Promise<void> | null = null;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** Ask again now (after a mark, a result or a page change); two asks at once share one request. */
export function refreshFollowUpCount(): void {
  askedAt = Date.now();
  asking ??= fetch("/api/follow-up?count=1", { credentials: "same-origin" })
    .then((r) => (r.ok ? (r.json() as Promise<{ count?: number }>) : null))
    .then((j) => {
      if (typeof j?.count === "number" && j.count !== count) {
        count = j.count;
        listeners.forEach((fn) => fn());
      }
    })
    .catch(() => undefined)
    .finally(() => {
      asking = null;
    });
}

/** The Follow up list has just been read, and its length is this person's count: no second question. */
export function setFollowUpCount(n: number): void {
  askedAt = Date.now();
  if (n === count) return;
  count = n;
  listeners.forEach((fn) => fn());
}

export function useFollowUpCount(): number {
  const path = usePathname();
  useEffect(() => {
    // the Follow up tab reads the whole list as it opens, and that sets the count
    const onTab = window.location.pathname === "/leads" && new URLSearchParams(window.location.search).get("tab") === "followup";
    if (!onTab && Date.now() - askedAt >= FRESH_MS) refreshFollowUpCount();
  }, [path]);
  return useSyncExternalStore(subscribe, () => count, () => 0);
}
