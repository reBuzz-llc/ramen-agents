import Link from "next/link";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { monthStartDate, OUTCOMES, standings, weightsOf } from "@/lib/leaderboard";
import { boardPages, taskPages } from "@/lib/notion";
import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import { teamNow, type NowRow } from "@/lib/shift-notes";
import type { NotionPage } from "@/lib/queue";
import { scoreboard, weekRows } from "@/lib/scoreboard";
import { startDayOf, weekStartDate } from "@/lib/week";

export const metadata = { title: "Leaderboard · ramen-agents" };

const LABEL: Record<(typeof OUTCOMES)[number], string> = { sent: "sent", replies: "reply", meetings: "meeting", clients: "client", tasksDone: "task done" };
const PERIODS = { week: "This week", month: "This month" } as const;
type Period = keyof typeof PERIODS;

// The team's leaderboard, by outcomes. Everyone sees it; the owner rewards from it.
export default async function Leaderboard(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const who = await pageMe();
  const period: Period = (await props.searchParams).p === "month" ? "month" : "week";
  const from = period === "month" ? monthStartDate() : weekStartDate(new Date(), startDayOf(who.settings));
  const d = await db();
  // The team's rows and both boards at once.
  const [{ people, clicks, shiftRows }, boards, now] = await Promise.all([
    weekRows(d, who.tenantId, from),
    Promise.all([boardPages(d, who.tenantId), taskPages(d, who.tenantId)]).then(
      ([pages, tasks]) => ({ pages, tasks, error: "" }),
      (err) => ({ pages: [] as NotionPage[], tasks: [] as NotionPage[], error: publicReason(err, "home") }),
    ),
    // Who is working right now: for the owner and managers only.
    can(who.role, "week.team") ? teamNow(d, who.tenantId, who.settings) : Promise.resolve(null),
  ]);
  const { pages, tasks, error: boardError } = boards;
  const w = weightsOf(who.settings.points);
  const board = standings(scoreboard(people, clicks, pages, tasks, shiftRows, from), w);
  const top = Math.max(1, ...board.map((r) => r.points));
  const medal = (rank: number) => (rank === 1 ? "🥇" : rank === 2 ? "🥈" : rank === 3 ? "🥉" : "");

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Leaderboard</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            Points for what reached a customer or closed a task. Hours on the clock earn no points. A reply, meeting or
            client counts for the person who sent that lead.
          </p>
        </div>
        <nav className="flex gap-1 rounded-full border border-line bg-panel p-1 text-sm">
          {(Object.keys(PERIODS) as Period[]).map((k) => (
            <Link key={k} href={k === "week" ? "/leaderboard" : `/leaderboard?p=${k}`} aria-current={period === k ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full px-4 ${period === k ? "bg-accent-tint font-semibold text-accent-ink" : "text-muted hover:text-ink"}`}>
              {PERIODS[k]}
            </Link>
          ))}
        </nav>
      </div>

      {boardError ? <p className="mt-4 rounded-lg bg-panel p-3 text-sm text-muted">{boardError}</p> : null}

      {now ? <TeamNow rows={now} /> : null}

      {board.length ? (
        <>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {board.slice(0, 3).map((r) => (
              <div key={r.userId} className={`rounded-xl border bg-panel p-4 ${r.userId === who.userId ? "border-accent" : "border-line"}`}>
                <p className="text-sm text-muted">
                  {medal(r.rank)} #{r.rank}
                  {r.userId === who.userId ? " · you" : ""}
                </p>
                <p className="mt-1 truncate text-lg font-semibold">{r.name}</p>
                <p className="text-3xl font-semibold tabular-nums">
                  {r.points} <span className="text-sm font-normal text-muted">points</span>
                </p>
              </div>
            ))}
          </div>

          <table className="mt-6 w-full text-sm tabular-nums">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="w-10 py-2 font-normal">#</th>
                <th className="py-2 font-normal">Person</th>
                <th className="hidden py-2 font-normal sm:table-cell">Points</th>
                <th className="py-2 text-right font-normal">Sent</th>
                <th className="py-2 text-right font-normal">Replies</th>
                <th className="py-2 text-right font-normal">Meetings</th>
                <th className="py-2 text-right font-normal">Clients</th>
                <th className="py-2 text-right font-normal">Tasks</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {board.map((r) => (
                <tr key={r.userId} className={r.userId === who.userId ? "bg-panel font-semibold" : ""}>
                  <td className="py-2">{r.rank}</td>
                  <td className="py-2">
                    {r.name}
                    {r.userId === who.userId ? <span className="ml-1 text-xs font-normal text-muted">you</span> : null}
                    <span className="ml-2 font-semibold sm:hidden">{r.points}</span>
                  </td>
                  <td className="hidden w-1/3 py-2 sm:table-cell">
                    <div className="flex items-center gap-2" title={`${r.points} points`}>
                      <div className="h-2 rounded-r bg-accent" style={{ width: `${Math.max(2, (r.points / top) * 100)}%` }} />
                      <span>{r.points}</span>
                    </div>
                  </td>
                  <td className="py-2 text-right">{r.sent}</td>
                  <td className="py-2 text-right">{r.replies}</td>
                  <td className="py-2 text-right">{r.meetings}</td>
                  <td className="py-2 text-right">{r.clients}</td>
                  <td className="py-2 text-right">{r.tasksDone}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="mt-6 rounded-xl bg-panel p-4 text-sm text-muted">Nobody on the team yet. The owner adds people in Settings.</p>
      )}

      <p className="mt-6 text-xs text-muted">
        How points work: {OUTCOMES.map((k) => `${w[k]} per ${LABEL[k]}`).join(" · ")}. The owner sets these in Settings and is not on the board.
      </p>
    </div>
  );
}

const ago = (d: Date) => {
  const m = Math.max(0, Math.round((Date.now() - d.getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m ago`;
};

/** Team now: who is clocked in, on which project, their latest note and how long ago. Owner and managers. */
function TeamNow({ rows }: { rows: NowRow[] }) {
  return (
    <section className="mt-6 rounded-xl border border-line bg-panel p-4">
      <h2 className="text-sm font-semibold">
        Team now <span className="font-normal text-muted">· {rows.length ? `${rows.length} clocked in` : "nobody clocked in"}</span>
      </h2>
      {rows.length ? (
        <ul className="mt-2 divide-y divide-line text-sm">
          {rows.map((r) => (
            <li key={r.userId} className="flex flex-wrap items-baseline justify-between gap-x-3 py-2">
              <span className="min-w-0">
                <b>{r.name}</b> <span className="text-muted">on {r.project}</span>
                {r.note ? <span className="block truncate text-muted sm:inline sm:before:content-['_·_']">{r.note}</span> : null}
              </span>
              <span className="shrink-0 text-xs text-muted tabular-nums">
                {r.overdueSince ? <span className="mr-2 rounded-full border border-accent px-2 py-0.5 text-ink">update due {ago(r.overdueSince)}</span> : null}
                {r.noteAt ? `note ${ago(r.noteAt)}` : `since ${ago(r.since)}`}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
