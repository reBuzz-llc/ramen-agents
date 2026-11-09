"use client";
// The dashboard's app/hooks.ts for the public bundle: everything as it is, except usePoll, which reads /state.
import { useWorldState } from "./state";
export { useNow, useVisibleInterval } from "@/app/hooks";

export function usePoll<T>(path: string, _everyMs: number): { data: T | null; error: string | null; at: number; reload: () => void } {
  const s = useWorldState();
  const data = path === "board" ? s.state?.board : path === "web" ? s.state?.web : null;
  return { data: (data ?? null) as T | null, error: s.error, at: s.at, reload: () => {} };
}
