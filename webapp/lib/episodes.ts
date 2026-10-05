// Server-side only: whole episodes from a bot's database, as structured data and as text to copy.
//
// The activity feed only holds the latest log lines, which often start mid-episode; the database has every
// episode with its question, each action (the model's thought, the verdict, the result), the notes saved and
// the summary written at the end. Read with macOS's own sqlite3 in read-only mode, so this app never
// writes a bot's database and needs no native Node module.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { BotProfile } from "./bot";
import { readConfig } from "./bots";

const run = promisify(execFile);
const SQLITE = "/usr/bin/sqlite3";
export const MAX_EPISODES = 50;

export type EpisodeAction = { ts: string; type: string; verdict: string; thought: string; result: string };
export type EpisodeNote = { title: string; body: string; sourceUrl: string | null };
export type EpisodeTask = { title: string; priority: string | null; url: string | null };
export type Episode = {
  id: number;
  startedAt: string;
  endedAt: string | null;
  status: string;
  question: string | null;
  summary: string;
  actions: EpisodeAction[];
  notes: EpisodeNote[];
  tasks: EpisodeTask[];
  text: string;
};

export async function dbPath(bot: BotProfile): Promise<string> {
  const cfg = await readConfig(bot.configPath);
  const rel = cfg.get("paths.db");
  return path.resolve(path.dirname(bot.configPath), typeof rel === "string" && rel ? rel : "workspace/explorer.sqlite3");
}

export type Row = Record<string, string | number | null>;

export async function query(db: string, sql: string): Promise<Row[]> {
  // -readonly plus a read-only URI: the bot writes this file (WAL), this app never does.
  const { stdout } = await run(SQLITE, ["-readonly", "-json", "-cmd", ".timeout 3000", `file:${db}?mode=ro`, sql], {
    timeout: 8000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.trim() ? (JSON.parse(stdout) as Row[]) : [];
}

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const hhmm = (iso: string | null) => (iso ? iso.slice(11, 16) : "");
const hhmmss = (iso: string) => iso.slice(11, 19) || iso;
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

function render(e: Omit<Episode, "text">): string {
  const when = e.endedAt ? `${e.startedAt.slice(0, 10)} ${hhmm(e.startedAt)}–${hhmm(e.endedAt)}` : `${e.startedAt.slice(0, 10)} ${hhmm(e.startedAt)}–now`;
  const lines = [
    `Episode ${e.id} · ${when} · ${e.status} · ${e.actions.length} action${e.actions.length === 1 ? "" : "s"}`,
    `Question: ${e.question ?? "(free exploration)"}`,
    "",
  ];
  for (const a of e.actions) {
    const verdict = a.verdict === "allowed" ? "" : ` [${oneLine(a.verdict)}]`;
    lines.push(`${hhmmss(a.ts)}  ${a.type}${verdict}: ${oneLine(a.result) || "(no result)"}`);
    if (a.thought.trim()) lines.push(`          thought: ${oneLine(a.thought)}`);
  }
  if (e.notes.length) {
    lines.push("", "Notes");
    for (const n of e.notes) lines.push(`- ${n.title}: ${oneLine(n.body)}${n.sourceUrl ? ` (${n.sourceUrl})` : ""}`);
  }
  if (e.tasks.length) {
    lines.push("", "Tasks");
    for (const t of e.tasks) lines.push(`- ${t.title}${t.priority ? ` [${t.priority}]` : ""}${t.url ? ` ${t.url}` : ""}`);
  }
  if (e.summary.trim()) lines.push("", "Journal", e.summary.trim());
  return lines.join("\n");
}

/** One episode by id, or the latest `limit` (newest first). Ids are integers, so they are safe to inline. */
export async function readEpisodes(bot: BotProfile, opts: { id?: number; limit?: number }): Promise<Episode[]> {
  const db = await dbPath(bot);
  const where =
    opts.id !== undefined
      ? `WHERE e.id = ${Math.trunc(opts.id)}`
      : "";
  const limit = Math.max(1, Math.min(MAX_EPISODES, Math.trunc(opts.limit ?? 10)));
  const heads = await query(
    db,
    `SELECT e.id, e.started_at, e.ended_at, e.status, coalesce(e.summary, '') AS summary, q.question
       FROM episodes e LEFT JOIN questions q ON q.id = e.question_id
       ${where} ORDER BY e.id DESC LIMIT ${opts.id !== undefined ? 1 : limit}`,
  );
  if (!heads.length) return [];
  const ids = heads.map((h) => Number(h.id)).filter(Number.isInteger).join(",");
  const [actions, notes, tasks] = await Promise.all([
    query(db, `SELECT episode_id, ts, action_type, verdict, coalesce(thought, '') AS thought, coalesce(result, '') AS result FROM actions WHERE episode_id IN (${ids}) ORDER BY id`),
    query(db, `SELECT episode_id, title, body, source_url FROM notes WHERE episode_id IN (${ids}) ORDER BY id`),
    // Only bots with the Notion skill have created tasks; older databases may not have the table.
    query(db, `SELECT episode_id, title, priority, url FROM tasks WHERE episode_id IN (${ids}) ORDER BY id`).catch(() => [] as Row[]),
  ]);
  const by = <T,>(rows: Row[], map: (r: Row) => T) => {
    const out = new Map<number, T[]>();
    for (const r of rows) {
      const k = Number(r.episode_id);
      out.set(k, [...(out.get(k) ?? []), map(r)]);
    }
    return out;
  };
  const actionsBy = by(actions, (r) => ({ ts: str(r.ts), type: str(r.action_type), verdict: str(r.verdict), thought: str(r.thought), result: str(r.result) }));
  const notesBy = by(notes, (r) => ({ title: str(r.title), body: str(r.body), sourceUrl: r.source_url ? str(r.source_url) : null }));
  const tasksBy = by(tasks, (r) => ({ title: str(r.title), priority: r.priority ? str(r.priority) : null, url: r.url ? str(r.url) : null }));
  return heads.map((h) => {
    const id = Number(h.id);
    const q = h.question ? str(h.question) : null;
    const base = {
      id,
      startedAt: str(h.started_at),
      endedAt: h.ended_at ? str(h.ended_at) : null,
      status: str(h.status),
      question: q && q !== "None" ? q : null,
      summary: str(h.summary),
      actions: actionsBy.get(id) ?? [],
      notes: notesBy.get(id) ?? [],
      tasks: tasksBy.get(id) ?? [],
    };
    return { ...base, text: render(base) };
  });
}
