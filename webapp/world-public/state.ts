"use client";
// The public office's one data source: GET /state every 15 s with the link's token, shared by every
// usePoll in the bundle ("board", "web") and the Feed tab. A 403 says where to open the world from.
import { useSyncExternalStore } from "react";
import type { PublicState } from "@/lib/world-public";

const EVERY_MS = 15_000;
type Snap = { state: PublicState | null; error: string | null; at: number };
let snap: Snap = { state: null, error: null, at: 0 };
const subs = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

const token = (() => {
  if (typeof window === "undefined") return "";
  const t = new URLSearchParams(window.location.search).get("t") ?? "";
  // the token stays in memory; the address bar loses it so a copied link from here carries nothing
  if (t) window.history.replaceState(null, "", window.location.pathname);
  return t;
})();

async function load() {
  try {
    const r = await fetch("/state", { cache: "no-store", headers: token ? { "x-world-token": token } : {}, credentials: "same-origin" });
    if (r.status === 403) snap = { ...snap, error: "This link has expired: open the office again from the team portal." };
    else if (!r.ok) snap = { ...snap, error: (await r.text().catch(() => "")).slice(0, 200) || `HTTP ${r.status}` };
    else snap = { state: (await r.json()) as PublicState, error: null, at: Date.now() };
  } catch {
    snap = { ...snap, error: "The live world did not answer; it tries again in 15 seconds." };
  }
  subs.forEach((f) => f());
}

function subscribe(f: () => void) {
  subs.add(f);
  if (!timer) {
    void load();
    timer = setInterval(() => document.visibilityState === "visible" && void load(), EVERY_MS);
  }
  return () => {
    subs.delete(f);
  };
}

export function useWorldState(): Snap {
  return useSyncExternalStore(subscribe, () => snap, () => snap);
}
