import { pageMe } from "@/lib/page-me";
import { publicReason } from "@/lib/errors";
import { db } from "@/lib/db";
import Link from "next/link";
import { boardPages, taskPages } from "@/lib/notion";
import type { NotionPage } from "@/lib/queue";
import { can } from "@/lib/roles";
import { scoreboard, weekRows } from "@/lib/scoreboard";
import { projectName, projectsOf, type Project } from "@/lib/projects";
import { hhmm, minutesByProject, type ProjectShift } from "@/lib/timesheet";
import { startDayOf, weekStart, weekStartDate, WEEKDAYS } from "@/lib/week";

export const metadata = { title: "This week · ramen-agents" };

export default async function WeekPage() {
  const who = await pageMe();
  const d = await db();
  const startDay = startDayOf(who.settings);
  const from = weekStartDate(new Date(), startDay);
  const step = who.settings.updates?.rounding ?? 0;
  // The team's rows and both boards at once.
  const [{ people, clicks, shiftRows }, boards, projectList] = await Promise.all([
    weekRows(d, who.tenantId, from),
    Promise.all([boardPages(d, who.tenantId), taskPages(d, who.tenantId)]).then(
      ([pages, tasks]) => ({ pages, tasks, error: "" }),
      (err) => ({ pages: [] as NotionPage[], tasks: [] as NotionPage[], error: publicReason(err, "week") }),
    ),
    projectsOf(d, who.tenantId),
  ]);
  const { pages, tasks, error: boardError } = boards;
  const all = scoreboard(people, clicks, pages, tasks, shiftRows, from, new Date(), step);
  const rows = can(who.role, "week.team") ? all : all.filter((r) => r.userId === who.userId);
  const kr = who.settings.keyResults ?? {};
  const total = (k: "sent" | "replies" | "meetings" | "tasksDone") => all.reduce((t, r) => t + r[k], 0);
  const tiles: { label: string; value: number; target?: number }[] = [
    { label: "Sent", value: total("sent"), target: kr.sent },
    { label: "Replies", value: total("replies"), target: kr.replies },
    { label: "Meetings", value: total("meetings"), target: kr.meetings },
    { label: "Tasks done", value: total("tasksDone"), target: kr.tasksDone },
  ];
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">This week</h1>
      <p className="mt-1 text-sm text-muted">Since {WEEKDAYS[startDay]} {weekStart(new Date(), startDay)}.{step ? ` Hours are rounded to ${step} minutes per shift.` : ""} A reply or meeting counts for the person who sent that lead.</p>
      {boardError ? <p className="mt-4 rounded-lg bg-panel p-3 text-sm text-muted">{boardError}</p> : null}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl border border-line bg-panel p-4">
            <p className="text-xs text-muted">{t.label}</p>
            <p className="text-3xl font-semibold tabular-nums">
              {t.value}
              {t.target ? <span className="text-base font-normal text-muted"> / {t.target}</span> : null}
            </p>
          </div>
        ))}
      </div>
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
              <td className="py-2 text-right">{r.sent}</td>
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
