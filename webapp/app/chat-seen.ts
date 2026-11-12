"use client";
import { useSyncExternalStore } from "react";

// Which agents' replies the owner has seen (queue 35): per slug, the time of the last reply read in its Chat tab, kept
// in this browser. Every view subscribes (the room's dots, the panel's Chat tab, the List cards, Notifications), so
// opening a tab clears the dot everywhere at once. Without storage (a private window) nothing is remembered and a
// reply shows as unread until the tab is opened in this visit.
const KEY = "chat-seen";
const EVENT = "chatseenchange";
let memory: Record<string, string> = {};
let cache: { raw: string | null; value: Record<string, string> } = { raw: null, value: {} };

function read(): Record<string, string> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch {
    return memory;
  }
  if (raw === cache.raw) return cache.value;
  let value: Record<string, string> = {};
  try {
    value = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    /* a broken value: start again */
  }
  cache = { raw, value };
  return value;
}

/** The owner has seen `slug`'s replies up to `ts`. */
export function markSeen(slug: string, ts: string) {
  const now = read();
  if (now[slug] && now[slug] >= ts) return;
  const next = { ...now, [slug]: ts };
  memory = next;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* kept in memory for this visit */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

const EMPTY: Record<string, string> = {};
export function useChatSeen(): Record<string, string> {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
