import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { pageMe } from "@/lib/page-me";
import { dayBounds, logOf, logProject, shiftDay } from "@/lib/project-log";
import { hhmm } from "@/lib/timesheet";

export const metadata = { title: "Project log · ramen-agents" };

const time = (d: Date) => d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// A project's day as a client-readable log: every "Now doing…" update in order, the time on it, and a PDF for the client.
export default async function ProjectLogPage(props: PageProps<"/projects/[id]">) {
  const who = await pageMe();
  const d = await db();
  const { id } = await props.params;
  const project = await logProject(d, who.tenantId, id);
  if (!project) notFound();
  const day = dayBounds((await props.searchParams).day);
  const log = await logOf(d, who.tenantId, project, day);
  const nav = "inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold hover:border-accent";
  return (
    <div className="max-w-2xl">
      <Link href="/#projects" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent-ink hover:underline">
        ← Clock
      </Link>
      <p className="text-sm text-muted">Project log</p>
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">
        {project.name} {project.client ? <span className="text-base font-normal text-muted">for {project.client}</span> : null}
      </h1>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Link href={`/projects/${id}?day=${shiftDay(day.day, -1)}`} className={nav}>
          ← Day before
        </Link>
        <span className="px-2 text-sm font-semibold tabular-nums">{day.day}</span>
        <Link href={`/projects/${id}?day=${shiftDay(day.day, 1)}`} className={nav}>
          Day after →
        </Link>
        <a href={`/api/projects/${id}/log?day=${day.day}`} className="ml-auto inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-base font-semibold text-on-accent hover:bg-accent-hover">
          PDF for the client
        </a>
      </div>
      <p className="mt-4 text-sm text-muted">
        {hhmm(log.minutes)} on this project · {log.lines.length} {log.lines.length === 1 ? "update" : "updates"}. Text only: no pay, no screenshots.
      </p>
      {log.lines.length ? (
        <ol className="mt-4 divide-y divide-line rounded-xl border border-line bg-panel">
          {log.lines.map((l, i) => (
            <li key={i} className="flex gap-3 px-4 py-2 text-sm">
              <span className="shrink-0 text-muted tabular-nums">{time(l.at)}</span>
              <span>
                <b className="font-medium">{l.name}</b> {l.text}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-4 rounded-xl bg-panel p-4 text-sm text-muted">No updates were posted on this project this day.</p>
      )}
    </div>
  );
}
