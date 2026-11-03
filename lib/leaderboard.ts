// The home page: who is ahead, by outcomes. Points come from what reached a customer or closed a task (sent, replies,
// meetings, clients, tasks done), never from hours or activity, so nobody wins by keeping a clock running. The owner
// sets the weights in Settings and is left off the board (the owner gives the rewards). Pure functions, tested.
import type { PersonWeek } from "./scoreboard";

export type Weights = { sent: number; replies: number; meetings: number; clients: number; tasksDone: number };
export const DEFAULT_WEIGHTS: Weights = { sent: 1, replies: 3, meetings: 5, clients: 10, tasksDone: 2 };
export const OUTCOMES = ["sent", "replies", "meetings", "clients", "tasksDone"] as const;

export type Standing = PersonWeek & { points: number; rank: number };

export const weightsOf = (set?: Partial<Weights>): Weights => ({ ...DEFAULT_WEIGHTS, ...Object.fromEntries(Object.entries(set ?? {}).filter(([, v]) => typeof v === "number")) });

export const pointsOf = (r: PersonWeek, w: Weights) => OUTCOMES.reduce((t, k) => t + r[k] * w[k], 0);

/** Everyone but the owner, most points first. Equal points share a rank (1, 2, 2, 4); ties list the most clients,
 *  then meetings, then replies first, then by name. */
export function standings(rows: PersonWeek[], w: Weights): Standing[] {
  const sorted = rows
    .filter((r) => r.role !== "owner")
    .map((r) => ({ ...r, points: pointsOf(r, w), rank: 0 }))
    .sort((a, b) => b.points - a.points || b.clients - a.clients || b.meetings - a.meetings || b.replies - a.replies || a.name.localeCompare(b.name));
  sorted.forEach((r, i) => (r.rank = i && r.points === sorted[i - 1].points ? sorted[i - 1].rank : i + 1));
  return sorted;
}

/** The first day of this month, local time. */
export const monthStartDate = (now = new Date()) => new Date(now.getFullYear(), now.getMonth(), 1);
