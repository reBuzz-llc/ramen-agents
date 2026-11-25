// Filters on one person's Taken page: a word, held or sent, the channel, the place, the industry group and who
// changed the lead. Pure functions, tested; the page keeps the choices in its address so a filtered view survives a reload.
import { industryGroup } from "./lead-filters";
import type { TakenItem } from "./taken-view";

export const TAKEN_FILTER_KEYS = ["q", "show", "channel", "place", "industry", "changes"] as const;
export type TakenFilterKey = (typeof TAKEN_FILTER_KEYS)[number];
export type TakenFilters = Record<TakenFilterKey, string>;
export type TakenOption = [value: string, label: string];

export const NO_TAKEN_FILTERS: TakenFilters = { q: "", show: "", channel: "", place: "", industry: "", changes: "" };

const SHOW: Record<string, string> = { held: "Held", sent: "Sent this week" };
const CHANNEL: Record<string, string> = { Email: "Email", WhatsApp: "WhatsApp" };
const CHANGES: Record<string, string> = { today: "Changed today", other: "Changed by someone else", none: "No change by a person" };
const NOT_SET = "(not set)";

const placeOf = (i: TakenItem) => i.where || NOT_SET;
const groupOf = (i: TakenItem) => industryGroup(i.industry);

/** The filters in the address. A value that is not one of a fixed list's choices is ignored. */
export function readTakenFilters(sp: Record<string, string | string[] | undefined>): TakenFilters {
  const one = (k: TakenFilterKey) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.slice(0, 200) ?? "";
  };
  const only = (k: TakenFilterKey, ok: Record<string, string>) => (Object.hasOwn(ok, one(k)) ? one(k) : "");
  return { q: one("q"), show: only("show", SHOW), channel: only("channel", CHANNEL), place: one("place"), industry: one("industry"), changes: only("changes", CHANGES) };
}

export function takenMatches(i: TakenItem, f: TakenFilters): boolean {
  const q = f.q.trim().toLowerCase();
  if (q && !`${i.business} ${i.where} ${i.industry}`.toLowerCase().includes(q)) return false;
  if (f.show && (f.show === "sent") !== i.sent) return false;
  if (f.channel && i.kind !== f.channel) return false;
  if (f.place && placeOf(i) !== f.place) return false;
  if (f.industry && groupOf(i) !== f.industry) return false;
  if (f.changes) {
    const byPeople = i.changes.filter((c) => c.person);
    if (f.changes === "today" && !byPeople.some((c) => c.today)) return false;
    if (f.changes === "other" && !byPeople.some((c) => c.other)) return false;
    if (f.changes === "none" && byPeople.length) return false;
  }
  return true;
}

/** Each dropdown's choices, with how many leads each would show under the other filters. A chosen value always stays listed. */
export function takenOptions(items: TakenItem[], f: TakenFilters): Record<Exclude<TakenFilterKey, "q">, TakenOption[]> {
  const count = (k: TakenFilterKey, v: string) => items.filter((i) => takenMatches(i, { ...f, [k]: v })).length;
  const fixed = (k: TakenFilterKey, labels: Record<string, string>) => Object.entries(labels).map(([v, l]): TakenOption => [v, `${l} (${count(k, v)})`]);
  const free = (k: "place" | "industry", pick: (i: TakenItem) => string) => {
    const rest = items.filter((i) => takenMatches(i, { ...f, [k]: "" }));
    const tally = new Map<string, number>();
    for (const i of rest) tally.set(pick(i), (tally.get(pick(i)) ?? 0) + 1);
    if (f[k] && !tally.has(f[k])) tally.set(f[k], 0);
    return [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([v, n]): TakenOption => [v, `${v} (${n})`]);
  };
  return { show: fixed("show", SHOW), channel: fixed("channel", CHANNEL), place: free("place", placeOf), industry: free("industry", groupOf), changes: fixed("changes", CHANGES) };
}
