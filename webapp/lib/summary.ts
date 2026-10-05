// Server-side only: what a bot did over a period, for the Summary tab. Read-only queries on the bot's own
// database (see lib/episodes.ts): activity per time bucket, totals against the previous period, the
// sources it read, its episodes, and the trail from questions through episodes and notes to tasks.
import type { BotProfile } from "./bot";
import { dbPath, query, type Row } from "./episodes";

export const RANGES = {
  "24h": { label: "24 hours", ms: 24 * 3600e3, bucket: "hour" },
  "7d": { label: "7 days", ms: 7 * 86400e3, bucket: "day" },
  "30d": { label: "30 days", ms: 30 * 86400e3, bucket: "day" },
  "90d": { label: "90 days", ms: 90 * 86400e3, bucket: "week" },
} as const;
export type RangeKey = keyof typeof RANGES;


// Four action groups: few enough for distinct colors and a legend that stays readable.
export const GROUPS = ["reading", "writing", "output", "other"] as const;
export type Group = (typeof GROUPS)[number];
const GROUP_OF: Record<string, Group> = {
  search: "reading", open: "reading", follow: "reading", read: "reading", back: "reading",
  note: "writing", ask: "writing", interest: "writing", summarize: "writing",
  task: "output", package: "output", provider: "output", say: "output", message: "output", publish: "output",
};

export type Bucket = { start: string; label: string; counts: Record<Group, number>; refused: number };
export type Totals = { episodes: number; notes: number; answered: number; asked: number; tasks: number; pages: number; actions: number; refused: number };
export type TrailNode = { id: string; kind: "question" | "episode" | "note" | "task"; label: string; detail: string; at: string; href: string | null; status?: string };
export type TrailEdge = { from: string; to: string; kind: "pursued" | "noted" | "answers" | "created" };
export type SummaryData = {
  range: RangeKey;
  since: string;
  buckets: Bucket[];
  totals: Totals;
  previous: Totals;
  byAction: { action: string; group: Group; count: number }[];
  domains: { domain: string; pages: number }[];
  episodes: { id: number; question: string | null; startedAt: string; endedAt: string | null; status: string; actions: number; notes: number; tasks: number; summary: string }[];
  trail: { nodes: TrailNode[]; edges: TrailEdge[] };
};

/** Local time as the bots write it: 2026-09-15T10:42:28. */
export function localIso(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
export const sq = (s: string) => `'${s.replace(/'/g, "''")}'`;
const num = (v: unknown) => Number(v ?? 0) || 0;
const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));

export function bucketStarts(range: RangeKey, now: number): number[] {
  const r = RANGES[range];
  const d = new Date(now);
  let first: Date;
  let step: number;
  let count: number;
  if (r.bucket === "hour") {
    d.setMinutes(0, 0, 0);
    step = 3600e3;
    count = 24;
    first = new Date(d.getTime() - (count - 1) * step);
  } else if (r.bucket === "day") {
    d.setHours(0, 0, 0, 0);
    count = range === "7d" ? 7 : 30;
    step = 86400e3;
    first = new Date(d.getTime() - (count - 1) * step);
  } else {
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
    count = 13;
    step = 7 * 86400e3;
    first = new Date(d.getTime() - (count - 1) * step);
  }
  return Array.from({ length: count }, (_, i) => first.getTime() + i * step);
}

export function bucketLabel(range: RangeKey, ms: number): string {
  const d = new Date(ms);
  if (RANGES[range].bucket === "hour") return `${String(d.getHours()).padStart(2, "0")}:00`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export async function totals(db: string, from: string, to: string): Promise<Totals> {
  const [r] = await query(
    db,
    `SELECT
      (SELECT COUNT(*) FROM episodes WHERE started_at >= ${sq(from)} AND started_at < ${sq(to)}) AS episodes,
      (SELECT COUNT(*) FROM notes WHERE created_at >= ${sq(from)} AND created_at < ${sq(to)}) AS notes,
      (SELECT COUNT(*) FROM questions WHERE answered_at >= ${sq(from)} AND answered_at < ${sq(to)}) AS answered,
      (SELECT COUNT(*) FROM questions WHERE created_at >= ${sq(from)} AND created_at < ${sq(to)}) AS asked,
      (SELECT COUNT(*) FROM visits WHERE visited_at >= ${sq(from)} AND visited_at < ${sq(to)} AND ok = 1) AS pages,
      (SELECT COUNT(*) FROM actions WHERE ts >= ${sq(from)} AND ts < ${sq(to)}) AS actions,
      (SELECT COUNT(*) FROM actions WHERE ts >= ${sq(from)} AND ts < ${sq(to)} AND verdict != 'allowed') AS refused`,
  );
  // Only bots with the Notion skill have a tasks table.
  const tasks = await query(db, `SELECT COUNT(*) AS n FROM tasks WHERE created_at >= ${sq(from)} AND created_at < ${sq(to)}`).catch(() => [{ n: 0 }] as Row[]);
  return { episodes: num(r?.episodes), notes: num(r?.notes), answered: num(r?.answered), asked: num(r?.asked), tasks: num(tasks[0]?.n), pages: num(r?.pages), actions: num(r?.actions), refused: num(r?.refused) };
}

export async function summary(bot: BotProfile, range: RangeKey): Promise<SummaryData> {
  const db = await dbPath(bot);
  const now = Date.now();
  const starts = bucketStarts(range, now);
  const since = localIso(starts[0]);
  const until = localIso(now + 60e3);
  const prevFrom = localIso(starts[0] - (now - starts[0]));

  const [current, previous, actionRows, domainRows, episodeRows] = await Promise.all([
    totals(db, since, until),
    totals(db, prevFrom, since),
    query(db, `SELECT ts, action_type, verdict FROM actions WHERE ts >= ${sq(since)}`),
    query(db, `SELECT domain, COUNT(*) AS pages FROM visits WHERE visited_at >= ${sq(since)} AND ok = 1 GROUP BY domain ORDER BY pages DESC LIMIT 8`),
    query(
      db,
      `SELECT e.id, e.started_at, e.ended_at, e.status, e.actions, coalesce(e.summary, '') AS summary, q.question,
              (SELECT COUNT(*) FROM notes n WHERE n.episode_id = e.id) AS notes
         FROM episodes e LEFT JOIN questions q ON q.id = e.question_id
        WHERE e.started_at >= ${sq(since)} OR (e.ended_at IS NULL AND e.status = 'open')
        ORDER BY e.id DESC LIMIT 40`,
    ),
  ]);

  const buckets: Bucket[] = starts.map((s) => ({ start: localIso(s), label: bucketLabel(range, s), counts: { reading: 0, writing: 0, output: 0, other: 0 }, refused: 0 }));
  const byAction = new Map<string, number>();
  for (const r of actionRows) {
    const t = localIso(new Date(str(r.ts)).getTime());
    let i = buckets.length - 1;
    while (i > 0 && t < buckets[i].start) i--;
    if (t < buckets[0].start) continue;
    const allowed = str(r.verdict) === "allowed";
    if (allowed) {
      const type = str(r.action_type);
      buckets[i].counts[GROUP_OF[type] ?? "other"]++;
      byAction.set(type, (byAction.get(type) ?? 0) + 1);
    } else buckets[i].refused++;
  }

  // The trail: episodes in the period (newest 14), their questions, notes and tasks.
  const trailEpisodes = episodeRows.slice(0, 14);
  const ids = trailEpisodes.map((e) => num(e.id)).filter(Boolean);
  const nodes: TrailNode[] = [];
  const edges: TrailEdge[] = [];
  const tasksByEpisode = new Map<number, number>();
  if (ids.length) {
    const list = ids.join(",");
    const [qs, notes, tasks] = await Promise.all([
      query(db, `SELECT DISTINCT q.id, q.question, q.status, q.answer_note_id, q.created_at, e.id AS episode_id FROM episodes e JOIN questions q ON q.id = e.question_id WHERE e.id IN (${list})`),
      query(db, `SELECT id, title, body, source_url, created_at, episode_id FROM notes WHERE episode_id IN (${list}) ORDER BY id DESC LIMIT 60`),
      query(db, `SELECT id, title, url, priority, created_at, episode_id FROM tasks WHERE episode_id IN (${list})`).catch(() => [] as Row[]),
    ]);
    const qSeen = new Set<string>();
    const answerOf = new Map<number, string>();
    for (const q of qs) {
      const id = `q${num(q.id)}`;
      if (!qSeen.has(id)) {
        qSeen.add(id);
        nodes.push({ id, kind: "question", label: str(q.question), detail: str(q.status) === "answered" ? "Answered" : "Open", at: str(q.created_at), href: null, status: str(q.status) });
        if (q.answer_note_id) answerOf.set(num(q.answer_note_id), id);
      }
      edges.push({ from: id, to: `e${num(q.episode_id)}`, kind: "pursued" });
    }
    for (const e of trailEpisodes) {
      nodes.push({ id: `e${num(e.id)}`, kind: "episode", label: `Episode ${num(e.id)}`, detail: str(e.summary).slice(0, 400), at: str(e.started_at), href: null, status: str(e.status) });
    }
    for (const n of notes) {
      const id = `n${num(n.id)}`;
      nodes.push({ id, kind: "note", label: str(n.title), detail: str(n.body).slice(0, 500), at: str(n.created_at), href: n.source_url ? str(n.source_url) : null });
      edges.push({ from: `e${num(n.episode_id)}`, to: id, kind: "noted" });
      const q = answerOf.get(num(n.id));
      if (q) edges.push({ from: id, to: q, kind: "answers" });
    }
    for (const t of tasks) {
      const id = `t${num(t.id)}`;
      tasksByEpisode.set(num(t.episode_id), (tasksByEpisode.get(num(t.episode_id)) ?? 0) + 1);
      nodes.push({ id, kind: "task", label: str(t.title), detail: t.priority ? `Priority ${str(t.priority)}` : "", at: str(t.created_at), href: t.url ? str(t.url) : null });
      edges.push({ from: `e${num(t.episode_id)}`, to: id, kind: "created" });
    }
  }

  return {
    range,
    since,
    buckets,
    totals: current,
    previous,
    byAction: [...byAction.entries()].map(([action, count]) => ({ action, group: GROUP_OF[action] ?? "other", count })).sort((a, b) => b.count - a.count),
    domains: domainRows.map((r) => ({ domain: str(r.domain), pages: num(r.pages) })),
    episodes: episodeRows.map((e) => ({
      id: num(e.id),
      question: e.question ? str(e.question) : null,
      startedAt: str(e.started_at),
      endedAt: e.ended_at ? str(e.ended_at) : null,
      status: str(e.status),
      actions: num(e.actions),
      notes: num(e.notes),
      tasks: tasksByEpisode.get(num(e.id)) ?? 0,
      summary: str(e.summary),
    })),
    trail: { nodes, edges },
  };
}
