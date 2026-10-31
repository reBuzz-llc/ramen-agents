"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { errorText } from "@/lib/format";

/** Run `fn` now, every `everyMs` while the tab is visible, and again when the tab comes back into view. */
export function useVisibleInterval(fn: () => void, everyMs: number): void {
  const latest = useRef(fn);
  useEffect(() => {
    latest.current = fn;
  }, [fn]);
  useEffect(() => {
    const tick = () => document.visibilityState === "visible" && latest.current();
    const first = setTimeout(() => latest.current(), 0);
    const timer = setInterval(tick, everyMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [everyMs]);
}

type Poll<T> = { data: T | null; error: string | null; at: number; reload: () => void };

/** Poll a JSON endpoint of this app (a path under /api/), keeping the last good data when a request fails. */
export function usePoll<T>(path: string, everyMs: number): Poll<T> {
  const [result, setResult] = useState<Omit<Poll<T>, "reload">>({ data: null, error: null, at: 0 });
  // Requests can overlap when a data server is slow (the proxy waits up to 8 s, some pages poll every 3 s): number
  // them and drop any answer older than one already shown, so a late timeout never replaces fresher data.
  const sent = useRef(0);
  const shown = useRef(0);
  const load = useCallback(async () => {
    const mine = ++sent.current;
    const apply = (next: (prev: Omit<Poll<T>, "reload">) => Omit<Poll<T>, "reload">) => {
      if (mine < shown.current) return;
      shown.current = mine;
      setResult(next);
    };
    try {
      const res = await fetch(`/api/${path}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) {
        apply((prev) => ({ ...prev, error: body?.detail ?? body?.error ?? `HTTP ${res.status}` }));
        return;
      }
      apply(() => ({ data: body as T, error: null, at: Date.now() }));
    } catch (err) {
      apply((prev) => ({ ...prev, error: errorText(err) }));
    }
  }, [path]);
  useVisibleInterval(() => void load(), everyMs);
  return { ...result, reload: () => void load() };
}

/** The current time in ms, updated every `everyMs`; 0 until the first tick so server and client render alike. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(0);
  useEffect(() => {
    const first = setTimeout(() => setNow(Date.now()), 0);
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [everyMs]);
  return now;
}

/** While `dirty`, warn before the owner leaves: a reload or tab close (beforeunload) and a click on any in-app link
 * to another page (the tabs, the bot switcher), which beforeunload never sees. The click is caught in the capture
 * phase, so Next's Link does not navigate unless the owner agrees. */
export function useLeaveGuard(dirty: boolean, message: string): void {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    const guard = (e: MouseEvent) => {
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.target === "_blank" || e.defaultPrevented) return;
      const to = new URL(a.href, window.location.href);
      if (to.origin !== window.location.origin || to.pathname === window.location.pathname) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", guard, true);
    return () => {
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", guard, true);
    };
  }, [dirty, message]);
}
