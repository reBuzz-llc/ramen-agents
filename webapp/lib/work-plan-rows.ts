// The Work plan's compact rows (creatorCC queue 20, 2026-10-30, owner: "the Work plan page is too long"): cards for the
// running bots; stopped bots behind a toggle; past jobs one line each on their own tab. The pure parts, for the
// tests. Type imports only.
import type { PastJob } from "./work-plan";

export type Tab = "plan" | "past" | "leads" | "checks";
const TAB_KEYS: Tab[] = ["plan", "past", "leads", "checks"];

/** Running bots in their order, stopped ones apart. */
export function partition<T extends { stopped: boolean }>(cards: T[]): { running: T[]; stopped: T[] } {
  return { running: cards.filter((c) => !c.stopped), stopped: cards.filter((c) => c.stopped) };
}

/** Each section's own page (owner, 2026-10-31: "these tabs could be a proper nav bar with a separate page for each"). */
export const TAB_PATH: Record<Tab, string> = { plan: "/work-plan", past: "/work-plan/past", leads: "/work-plan/leads", checks: "/work-plan/checks" };
export const tabOfPath = (pathname: string): Tab | null =>
  (Object.entries(TAB_PATH) as [Tab, string][]).find(([, p]) => p === pathname.replace(/\/$/, ""))?.[0] ?? null;

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

// A card with no plan in hand (creatorCC queue 56; owner, 18:50: "Enricher, Analyst and Scout show no checklist"): the
// last ended plan, greyed, under a one-line header from the board. Never an empty box.
export type EndedPlan = { task: string; status: string; ended: string | null; note: string; steps: { text: string; done: boolean }[] };

const one = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** One plan-history.jsonl line (the engine appends one when a plan ends), or null for a torn or empty line. */
export function historyEntry(raw: string): EndedPlan | null {
  if (!raw.trim()) return null;
  let r: Record<string, unknown>;
  try {
    r = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  if (!r || typeof r !== "object") return null;
  const steps = Array.isArray(r.steps)
    ? r.steps.slice(0, 20).map((x) => {
        const st = (x ?? {}) as Record<string, unknown>;
        return { text: one(st.text, 200), done: st.done === true };
      })
    : [];
  return {
    task: one(r.task, 240),
    status: one(r.status, 20),
    ended: typeof r.ended === "string" ? r.ended : null,
    note: one(r.note, 300),
    steps: steps.filter((s) => s.text),
  };
}

/** The newest ended plan in a plan-history.jsonl text (by its end stamp; the last line on a tie). */
export function lastEnded(text: string): EndedPlan | null {
  let best: EndedPlan | null = null;
  for (const raw of text.split("\n")) {
    const e = historyEntry(raw);
    if (!e) continue;
    if (!best || (e.ended ?? "") >= (best.ended ?? "")) best = e;
  }
  return best;
}

/** "ended 15:50 · stuck" (with the date when it was not today). */
export function endedLine(p: Pick<EndedPlan, "ended" | "status">, today: string): string {
  const at = p.ended ? (p.ended.slice(0, 10) === today ? p.ended.slice(11, 16) : `${p.ended.slice(5, 10)} ${p.ended.slice(11, 16)}`) : "";
  return [at ? `ended ${at}` : "ended", ending(p.status)].join(" · ");
}

/** The header over a card with no plan in hand: "No plan right now · resting: opened x.com", or for a bot the owner
 *  stopped, "stopped by the owner since 2026-10-30". */
export function noPlanHeader(o: { stoppedSince?: string | null; retired?: boolean; state?: string | null; last?: string | null }): string {
  if (o.stoppedSince) return `${o.retired ? "retired" : "stopped by the owner"} since ${o.stoppedSince}`;
  const now = [o.state, o.last].filter(Boolean).join(": ");
  return now ? `No plan right now · ${now}` : "No plan right now";
}

/** A past job's identity, stable across refreshes (its bot and when it ran), so an open row stays open on the same job
 *  when newer jobs arrive at the top (queue 80). */
export const pastKey = (j: Pick<PastJob, "slug" | "started" | "ended" | "task">) => `${j.slug}|${j.started ?? ""}|${j.ended ?? ""}|${j.task}`;

/** "attempt 2 of 3" for a task the same bot planned more than once (each plan a separate attempt, oldest first); empty
 *  for a task planned once. Keyed by pastKey. */
export function attempts(jobs: Pick<PastJob, "slug" | "started" | "ended" | "task">[]): Map<string, string> {
  const groups = new Map<string, Pick<PastJob, "slug" | "started" | "ended" | "task">[]>();
  for (const j of jobs) {
    const k = `${j.slug}|${j.task.trim().toLowerCase()}`;
    groups.set(k, [...(groups.get(k) ?? []), j]);
  }
  const out = new Map<string, string>();
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const sorted = [...g].sort((a, b) => ((a.started ?? "") < (b.started ?? "") ? -1 : 1));
    sorted.forEach((j, i) => out.set(pastKey(j), `attempt ${i + 1} of ${g.length}`));
  }
  return out;
}

/** The heading for a past job's day, by when it ended, in local time: "Today", "Yesterday", else "Sat 31 Oct". */
export function pastDay(ended: string | null, now = new Date()): string {
  if (!ended) return "Undated";
  const d = new Date(ended.slice(0, 10) + "T12:00:00");
  const day = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (ended.slice(0, 10) === day(now)) return "Today";
  if (ended.slice(0, 10) === day(y)) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
