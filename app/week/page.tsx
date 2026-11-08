import { pageMe } from "@/lib/page-me";
import { publicReason } from "@/lib/errors";
import { db } from "@/lib/db";
import Link from "next/link";
import { scoreFacts } from "@/lib/lead-queue";
import { can } from "@/lib/roles";
import GoalsNudge from "../goals-nudge";
import { followUpsSince } from "@/lib/follow-up";
import { draftsFixedSince } from "@/lib/draft-edits";
import { sendsLabel } from "@/lib/leaderboard";
import { scoreboard, weekRows } from "@/lib/scoreboard";
import { projectName, projectsOf, type Project } from "@/lib/projects";
import { hhmm, minutesByProject, type ProjectShift } from "@/lib/timesheet";
import { startDayOf, weekStart, weekStartDate, WEEKDAYS } from "@/lib/week";
import { displayName } from "@/lib/display-name";

export const metadata = { title: "This week · ramen-agents" };

export default async function WeekPage() {
  const who = await pageMe();
  const d = await db();
  const startDay = startDayOf(who.settings);
  const from = weekStartDate(new Date(), startDay);
  const step = who.settings.updates?.rounding ?? 0;
  // The team's rows and the board's leads and tasks at once.
  const [{ people, clicks, shiftRows }, boards, projectList] = await Promise.all([
    weekRows(d, who.tenantId, from),
    scoreFacts(d, who.tenantId, from).then(
      ({ leads, tasks }) => ({ leads, tasks, error: "" }),
      (err) => ({ leads: [], tasks: [], error: publicReason(err, "week") }),
    ),
    projectsOf(d, who.tenantId),
  ]);
  // follow-ups sent this week: their own line, never counted as sends
  const [followUps, fixed] = await Promise.all([followUpsSince(d, who.tenantId, weekStart(new Date(), startDay)), draftsFixedSince(d, who.tenantId, weekStart(new Date(), startDay))]);
  const myName = displayName(who.name, who.email);
  // counts kept under a full address (written before names were shortened) join the person's short name
  const byShown = (m: Map<string, number>) => {
    const out = new Map<string, number>();
    for (const [k, n] of m) {
      const key = k.includes("@") ? displayName("", k) : k;
      out.set(key, (out.get(key) ?? 0) + n);
    }
    return out;
  };
  const followShown = can(who.role, "week.team") ? [...byShown(followUps).entries()].sort((a, b) => b[1] - a[1]) : [[myName, byShown(followUps).get(myName) ?? 0] as [string, number]];
  const followTotal = followShown.reduce((t, [, n]) => t + n, 0);
  // drafts fixed this week: a person's edit of an agent's email or WhatsApp draft, once per lead
  const fixedShown = can(who.role, "week.team") ? [...byShown(fixed).entries()].sort((a, b) => b[1] - a[1]) : [[myName, byShown(fixed).get(myName) ?? 0] as [string, number]];
  const fixedTotal = fixedShown.reduce((t, [, n]) => t + n, 0);
  const { leads, tasks, error: boardError } = boards;
  const all = scoreboard(people, clicks, leads, tasks, shiftRows, from, new Date(), step);
  const rows = can(who.role, "week.team") ? all : all.filter((r) => r.userId === who.userId);
  const kr = who.settings.keyResults ?? {};
  const total = (k: "sent" | "whatsapp" | "replies" | "meetings" | "tasksDone") => all.reduce((t, r) => t + (r[k] ?? 0), 0);
  const wa = total("whatsapp");
  const tiles: { label: string; value: number; target?: number; note?: string }[] = [
    // the key result is emails sent; WhatsApp messages sent show beside it
    { label: "Sent", value: total("sent"), target: kr.sent, note: wa ? `emails · ${wa} WhatsApp` : undefined },
    { label: "Replies", value: total("replies"), target: kr.replies },
    { label: "Meetings", value: total("meetings"), target: kr.meetings },
    { label: "Tasks done", value: total("tasksDone"), target: kr.tasksDone },
  ];
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">This week</h1>
      <p className="mt-1 text-sm text-muted">Since {WEEKDAYS[startDay]} {weekStart(new Date(), startDay)}.{step ? ` Hours are rounded to ${step} minutes per shift.` : ""} A reply or meeting counts for the person who sent that lead.</p>
      <GoalsNudge role={who.role} keyResults={kr} className="mt-4" />
      {boardError ? <p className="mt-4 rounded-lg bg-panel p-3 text-sm text-muted">{boardError}</p> : null}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-line bg-panel p-4">
            <p className="text-xs text-muted">{t.label}</p>
            <p className="flex flex-wrap items-baseline gap-x-1.5 text-2xl font-semibold tabular-nums lg:text-3xl">
              <span>{t.value}</span>
              {t.target ? <span className="whitespace-nowrap text-base font-normal text-muted">/ {t.target}</span> : null}
            </p>
            {t.note ? <p className="text-xs text-muted">{t.note}</p> : null}
          </div>
        ))}
      </div>
      <p data-follow-ups className="mt-3 text-sm">
        <span className="text-muted">Follow-ups sent: </span>
        <span className="font-semibold tabular-nums">{followTotal}</span>
        {followShown.length > 1 || (followShown.length === 1 && can(who.role, "week.team")) ? (
          <span className="text-muted"> · {followShown.map(([n, c]) => `${n} ${c}`).join(" · ")}</span>
        ) : null}
        <span className="text-muted"> (a second note to a lead that was sent; not counted as a send)</span>
      </p>
      <p data-drafts-fixed className="mt-1 text-sm">
        <span className="text-muted">Drafts fixed: </span>
        <span className="font-semibold tabular-nums">{fixedTotal}</span>
        {can(who.role, "week.team") && fixedShown.length ? <span className="text-muted"> · {fixedShown.map(([n, c]) => `${n} ${c}`).join(" · ")}</span> : null}
        <span className="text-muted"> (an agent&apos;s email or WhatsApp draft you rewrote: what the agents learn from)</span>
      </p>
      <div className="relative mt-6 overflow-x-auto">
      <table className="w-full min-w-[34rem] text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-2 font-normal">Person</th>
            <th className="py-2 text-right font-normal">Sent</th>
            <th className="py-2 text-right font-normal">Replies</th>
            <th className="py-2 text-right font-normal">Meetings</th>
            <th className="py-2 text-right font-normal">Clients</th>
            <th className="py-2 text-right font-normal">Tasks</th>
            <th className="py-2 text-right font-normal">Clocked</th>
            <th className="py-2 font-normal"><span className="sr-only">Statement</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.userId}>
              <td className="py-2">
                {r.name} <span className="text-xs text-muted">{r.role}</span>
              </td>
              <td className="py-2 text-right whitespace-nowrap">{sendsLabel(r)}</td>
              <td className="py-2 text-right">{r.replies}</td>
              <td className="py-2 text-right">{r.meetings}</td>
              <td className="py-2 text-right">{r.clients}</td>
              <td className="py-2 text-right">{r.tasksDone}</td>
              <td className="py-2 text-right">{hhmm(r.minutes)}</td>
              <td className="py-2 pl-3 text-right">
                <Link href={`/week/statement/${r.userId}?week=${weekStart(new Date(), startDay)}`} className="inline-flex min-h-11 items-center text-sm text-accent-ink hover:underline">
                  Statement
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="mt-3 text-xs text-muted">Tasks done come from the team task board.</p>

      <HoursByProject rows={rows} shiftRows={shiftRows} projectList={projectList} />
    </div>
  );
}

/** Hours per project per person this week (each person sees their own row; owner and managers see everyone's). */
function HoursByProject({ rows, shiftRows, projectList }: { rows: { userId: string; name: string }[]; shiftRows: (ProjectShift & { userId: string })[]; projectList: Project[] }) {
  const per = new Map(rows.map((r) => [r.userId, minutesByProject(shiftRows.filter((s) => s.userId === r.userId))]));
  // Columns: every project anyone shown worked on this week, most hours first.
  const totals = new Map<string | null, number>();
  for (const m of per.values()) for (const [id, min] of m) totals.set(id, (totals.get(id) ?? 0) + min);
  const columns = [...totals].sort((a, b) => b[1] - a[1]).map(([id]) => id);
  if (!columns.length) return null;
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Hours by project</h2>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-2 font-normal">Person</th>
              {columns.map((id) => (
                <th key={id ?? "general"} className="py-2 text-right font-normal">
                  {projectName(projectList, id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.userId}>
                <td className="py-2">{r.name}</td>
                {columns.map((id) => (
                  <td key={id ?? "general"} className="py-2 text-right">
                    {per.get(r.userId)?.get(id) ? hhmm(per.get(r.userId)!.get(id)!) : <span className="text-muted">–</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
