// The Work plan's compact rows (2026-10-30, owner: "the Work plan page is too long"): cards for the
// running bots; stopped bots behind a toggle; past jobs one line each on their own tab. The pure parts, for the
// tests. Type imports only.
import type { PastJob } from "./work-plan";

export type Tab = "plan" | "past" | "leads" | "checks";
const TAB_KEYS: Tab[] = ["plan", "past", "leads", "checks"];

/** Running bots in their order, stopped ones apart. */
export function partition<T extends { stopped: boolean }>(cards: T[]): { running: T[]; stopped: T[] } {
  return { running: cards.filter((c) => !c.stopped), stopped: cards.filter((c) => c.stopped) };
}

/** The address's #fragment: a tab ("#past"), or a bot's slug, which opens the Work plan tab with that row expanded
 *  (the world's nameplates link to /work-plan#<slug>). "#agents" and "#target" are older links to the first tab. */
export function readHash(hash: string, slugs: string[]): { tab: Tab; open: string | null } {
  const h = decodeURIComponent(hash.replace(/^#/, ""));
  if ((TAB_KEYS as string[]).includes(h)) return { tab: h as Tab, open: null };
  if (slugs.includes(h)) return { tab: "plan", open: h };
  return { tab: "plan", open: null };
}

/** How a past plan ended, in the owner's words. */
const ending = (status: string) => (status === "done" ? "done" : status === "stuck" ? "stuck" : "set aside");

/** One past plan on one line: bot, task, when it ran, how it ended, active minutes. Newest first comes from the server. */
export function pastLine(j: Pick<PastJob, "name" | "task" | "started" | "ended" | "status" | "activeMin">): { bot: string; task: string; when: string; ended: string; active: string } {
  const day = (s: string | null) => (s ? s.replace("T", " ").slice(5, 16) : "");
  const from = day(j.started);
  const to = day(j.ended);
  const when = from && to ? (from.slice(0, 5) === to.slice(0, 5) ? `${from} to ${to.slice(6)}` : `${from} to ${to}`) : to || from || "—";
  const m = j.activeMin;
  const active = m === null ? "—" : m < 60 ? `${m} min active` : `${Math.floor(m / 60)} h ${m % 60} min active`;
  return { bot: j.name, task: j.task || "(untitled job)", when, ended: ending(j.status), active };
}
