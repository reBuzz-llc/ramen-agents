// Server-side only: the live family board's data, polled by the home page every 12 s. Each refresh
// reads every running bot's own files (lib/board.ts: one sqlite3 spawn, a 256 KB log tail and three small files per
// bot); the result is shared for 5 s so several open tabs cost one read. The team line comes from the Leads board,
// which is slow cold: its last value is served at once and refreshed in the background.
import { stat } from "node:fs/promises";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { boardBot, localIso, mergeFeed, type BotCard, type FeedItem } from "./board";
import { BOTS_DIR, listBots } from "./bots";
import { workspaceDir } from "./control";
import { dbPath } from "./episodes";
import { OWN_OUTPUT, parseOkr, type Okr } from "./family-stats";
import { familyReview, teamNumbers, type FamilyReview, type TeamNumbers } from "./family-review";
import type { Downtime } from "./downtime";
import { readRequests } from "./requests";
import { ownerDecisions } from "./owner-decisions";
import { describe, readBoard as readProposals } from "./ceo-proposals";

// retired: the owner retired it (RETIRED.md in its folder, no launch agents): drawn on its own mat, "Bring back".
export type Stopped = { slug: string; name: string; since: string; retired?: boolean };
// week: the Validator's shared-state/team-numbers.json (drafts waiting, Email Sent and replies this week), for the
// world's mailbox; counts: the decisions and open CEO proposals, for its bulletin board.
export type Week = { drafts: number; sent: number; replies: number; at: string } | null;
// The character's "7 days" tab (the Family review's numbers, moved into the world): accepted
// outputs by type, actions, refused share, crashes and the last output of its own kind. From familyReview() (60 s cache).
export type Week7 = {
  actions: number;
  refused: number;
  refusedShare: number;
  outputs: Record<string, number>;
  crashes: number;
  lastCrash: string | null;
  lastOutput: { label: string; ago: string; late: boolean } | null;
};
export type BoardDecision = { id: string; since: string; text: string; options: string[]; link: { label: string; href: string } | null };
export type Board = {
  at: string;
  cards: BotCard[];
  stopped: Stopped[];
  feed: FeedItem[];
  team: TeamNumbers | null;
  okr: Okr | null;
  week: Week;
  counts: { decisions: number; proposals: number; requests: number };
  // The bulletin board's prompts: the open CEO proposals, answered there with Yes / No, and the
  // owner's open decisions, answered there with their options, Done or Later (queue 32).
  proposals: { id: string; bot: string; change: string; reason: string; metric: string; expected: string; validator: string }[];
  decisions: BoardDecision[];
  week7: Record<string, Week7>;
  down: Downtime | null; // the last 24 h: Mac off and quiet spans
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const CACHE_MS = 5000;
const TEAM_MS = 60_000;
const g = globalThis as {
  __board?: { at: number; data: Promise<Board> };
  __boardTeam?: { at: number; data: TeamNumbers | null; busy: boolean };
  __boardReview?: { at: number; data: FamilyReview | null; busy: boolean };
};

/** The Family review's numbers, served from the last read and refreshed in the background (cold, it takes seconds). */
function review(): FamilyReview | null {
  const t = (g.__boardReview ??= { at: 0, data: null, busy: false });
  if (!t.busy && Date.now() - t.at > 60_000) {
    t.busy = true;
    familyReview()
      .then((d) => Object.assign(t, { at: Date.now(), data: d }))
      .catch(() => undefined)
      .finally(() => (t.busy = false));
  }
  return t.data;
}

function week7Of(r: FamilyReview | null): Record<string, Week7> {
  const out: Record<string, Week7> = {};
  for (const row of r?.rows ?? []) {
    const w = row.stats?.w7;
    if (!w || !row.stats) continue;
    out[row.slug] = {
      actions: w.actions,
      refused: w.refused,
      refusedShare: w.refusedShare,
      outputs: Object.fromEntries(Object.entries(w.accepted).filter(([, n]) => n > 0)),
      crashes: row.stats.crashes.w7,
      lastCrash: row.stats.crashes.last ? `${row.stats.crashes.last.ts.replace("T", " ").slice(5, 16)} ${row.stats.crashes.last.exception}` : null,
      lastOutput: row.output ? { label: row.output.label, ago: row.output.ago, late: row.output.late } : null,
    };
  }
  return out;
}

function team(): TeamNumbers | null {
  const t = (g.__boardTeam ??= { at: 0, data: null, busy: false });
  if (!t.busy && Date.now() - t.at > TEAM_MS) {
    t.busy = true;
    teamNumbers()
      .then((d) => Object.assign(t, { at: Date.now(), data: d }))
      .catch(() => undefined)
      .finally(() => (t.busy = false));
  }
  return t.data;
}

async function read(): Promise<Board> {
  const now = Date.now();
  const bots = await listBots();
  const stopped: Stopped[] = [];
  const cards = (
    await Promise.all(
      bots.map(async (bot) => {
        const ws = await workspaceDir(bot);
        // retired by the owner (10-30: Start on jobless-bot removed its STOP, and with no launch agents nothing ran)
        const retiredText = await readFile(/*turbopackIgnore: true*/ path.join(path.dirname(bot.configPath), "RETIRED.md"), "utf8").catch(() => null);
        if (retiredText !== null) {
          const date = /(\d{4}-\d{2}-\d{2})/.exec(retiredText)?.[1] ?? "";
          stopped.push({ slug: bot.slug, name: bot.name, since: date, retired: true });
          return null;
        }
        const stop = await stat(/*turbopackIgnore: true*/ path.join(ws, "STOP")).catch(() => null);
        // A STOP during restart-bot.sh (it keeps RESTARTING, under 5 minutes old) is the script's, not the owner's.
        const restart = await stat(/*turbopackIgnore: true*/ path.join(ws, "RESTARTING")).catch(() => null);
        const restarting = !!restart && now - restart.mtimeMs < 5 * 60e3;
        if (stop && !restarting) {
          stopped.push({ slug: bot.slug, name: bot.name, since: localIso(stop.mtimeMs).slice(0, 10) });
          return null;
        }
        const db = await dbPath(bot).catch(() => null);
        return boardBot({ slug: bot.slug, name: bot.name, handle: bot.handle ?? "" }, ws, db, OWN_OUTPUT[bot.slug] ?? null, now, restarting);
      }),
    )
  ).filter((c): c is BotCard => c !== null);
  const shared = path.join(BOTS_DIR, "common-data", "shared-state");
  const [okr, week, decisions, proposals, requests] = await Promise.all([
    readFile(/*turbopackIgnore: true*/ path.join(BOTS_DIR, "common-data", "botBox", "routed", "the-ceo", "okr-week.md"), "utf8").then(parseOkr, () => null),
    readFile(/*turbopackIgnore: true*/ path.join(shared, "team-numbers.json"), "utf8").then(
      (t): Week => {
        const w = JSON.parse(t) as Record<string, unknown>;
        return { drafts: num(w.drafts_waiting), sent: num(w.sent_this_week ?? w.sent_week), replies: num(w.replies_week), at: String(w.at ?? "") };
      },
      () => null,
    ),
    ownerDecisions(now).then((d) => d.open, () => []),
    readProposals().then((b) => b.open, () => []),
    // open priority requests (from The CEO by default): unanswered, unresolved, not expired
    readRequests(5000).then((l) => l.filter((r) => r.priority && !r.answeredAt && !r.resolvedAt && !r.expired).length, () => 0),
  ]);
  const fr = review();
  return {
    at: new Date(now).toISOString(),
    cards: cards.map((c) => ({ ...c, feed: [] })),
    stopped: stopped.sort((a, b) => a.name.localeCompare(b.name)),
    feed: mergeFeed(cards),
    team: team(),
    okr,
    week,
    counts: { decisions: decisions.length, proposals: proposals.length, requests },
    proposals: proposals.map((p) => ({
      id: p.id,
      bot: bots.find((b) => b.slug === p.bot)?.name ?? p.bot,
      change: describe(p.change),
      reason: p.reason,
      metric: p.metric,
      expected: p.expected,
      validator: p.validator_note,
    })),
    decisions: decisions.map((d) => ({ id: d.id, since: d.since, text: d.text, options: d.options, link: d.link })),
    week7: week7Of(fr),
    down: fr?.down.w24 ?? null,
  };
}

export async function liveBoard(): Promise<Board> {
  if (g.__board && Date.now() - g.__board.at < CACHE_MS) return g.__board.data;
  const data = read();
  g.__board = { at: Date.now(), data };
  data.catch(() => (g.__board = undefined));
  return data;
}
