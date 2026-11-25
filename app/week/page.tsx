import { pageMe } from "@/lib/page-me";
import { publicReason } from "@/lib/errors";
import { db } from "@/lib/db";
import Link from "next/link";
import { scoreFacts } from "@/lib/lead-queue";
import { can } from "@/lib/roles";
import GoalsNudge from "../goals-nudge";
import { takenCounts } from "@/lib/claims";
import { agentDraftsFixedSince } from "@/lib/draft-edits";
import { followUpsIn } from "@/lib/follow-up";
import { longOpenShifts } from "@/lib/open-clock";
import { scoreboard, weekRows } from "@/lib/scoreboard";
import { projectName, projectsOf, type Project } from "@/lib/projects";
import { hhmm, minutesByProject, type ProjectShift } from "@/lib/timesheet";
import { startDayOf, weekStart, WEEKDAYS } from "@/lib/week";
import { periodLinks, periodOf, weeksIn, workingDaysIn } from "@/lib/periods";
import { approvedIn, firstDataDay } from "@/lib/periods-db";
import PeriodPicker from "./period-picker";
import { displayName } from "@/lib/display-name";
import { goalsOf } from "@/lib/send-goals";
import { offBoardIds, onBoard } from "@/lib/team-board";

export const metadata = { title: "This week · Productive Peek" };

export default async function WeekPage(props: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const who = await pageMe();
  const d = await db();
  const sp = await props.searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const now = new Date();
  const startDay = startDayOf(who.settings);
  const tz = who.settings.timezone;
  // every period from one function, in the company's zone; the address carries the choice
  const period = periodOf({ p: one(sp.p), from: one(sp.from), to: one(sp.to), at: one(sp.at) }, now, who.settings);
  // the filter row's arrows: the same kind of period one step back, and on until the current one
  const steps = periodLinks(period, now, tz);
  const { from, until } = period;
  const end = until < now ? until : now;
  const thisWeek = weekStart(now, startDay, tz);
  const weeks = weeksIn(period, startDay).filter((w) => w <= thisWeek);
  const step = who.settings.updates?.rounding ?? 0;
  // The team's rows and the board's leads and tasks (Peek's own) at once.
  // one wave: the follow-ups and the drafts fixed are asked with the rest, not after them
  const [{ people, clicks, shiftRows: shiftsFrom }, boards, projectList, followUps, fixed, taken, longOpen, dataFrom, approved] = await Promise.all([
    weekRows(d, who.tenantId, from),
    scoreFacts(d, who.tenantId, from, tz).then(
      ({ leads }) => ({ leads, error: "" }),
      (err) => ({ leads: [], error: publicReason(err, "week") }),
    ),
    projectsOf(d, who.tenantId),
    // each follow-up marked sent, by channel (the Clock's day counts use the same rows), and only a person's rewrite of
    // an agent's draft. Both by user id, so someone named like the owner is never left off
    followUpsIn(d, who.tenantId, from, until),
    agentDraftsFixedSince(d, who.tenantId, from, until),
    // leads each person holds now (the "taken" column): taken, not yet sent or given back
    takenCounts(d, who.tenantId),
    // a clock left running over 14 hours
    longOpenShifts(d, who.tenantId),
    firstDataDay(d, who.tenantId, tz),
    approvedIn(d, who.tenantId, weeks),
  ]);
  const shiftRows = shiftsFrom.filter((s) => s.startedAt < until);
  const myName = displayName(who.name, who.email);
  // an owner account, and anyone the owner switched off, is on none of these lists and in
  // no total, so the totals equal the people shown
  const off = offBoardIds(people, who.settings);
  const team = can(who.role, "week.team");
  // the Drafts fixed and Follow-ups lines by user id: everyone on the board (team view), else oneself
  const nameOf = new Map(people.map((p) => [p.id, displayName(p.name ?? "", p.email ?? "")]));
  const perPerson = (m: Map<string, number>): [string, number][] =>
    team
      ? [...m.entries()].filter(([id]) => !off.has(id) && nameOf.has(id)).map(([id, n]) => [nameOf.get(id)!, n] as [string, number]).sort((a, b) => b[1] - a[1])
      : off.has(who.userId) ? [] : [[myName, m.get(who.userId) ?? 0]];
  const followShown = perPerson(new Map([...followUps].map(([id, c]) => [id, c.email + c.whatsapp])));
  const followTotal = followShown.reduce((t, [, n]) => t + n, 0);
  // drafts fixed this week: a person's edit of an agent's email or WhatsApp draft, once per lead
  const fixedShown = perPerson(fixed);
  const fixedTotal = fixedShown.reduce((t, [, n]) => t + n, 0);
  const { leads, error: boardError } = boards;
  const all = onBoard(scoreboard(people, clicks, leads, shiftRows, from, end, step, until, tz), off);
  const rows = team ? all : all.filter((r) => r.userId === who.userId);
  const keyResults = who.settings.keyResults ?? {};
  // the week's key results measure one week only
  const kr = period.key === "week" ? keyResults : {};
  // the daily send goals times the working days so far this week: what each person's sends are measured against
  const goals = goalsOf(who.settings);
  const days = workingDaysIn(period, now, tz);
  // the totals add the rows shown (oneself without the team view), the same people the goals count
  // one rule with the Clock: a day's sends are first messages and follow-ups
  const emailsOf = (r: { userId: string; sent: number }) => r.sent + (followUps.get(r.userId)?.email ?? 0);
  const whatsappOf = (r: { userId: string; whatsapp?: number }) => (r.whatsapp ?? 0) + (followUps.get(r.userId)?.whatsapp ?? 0);
  const total = (k: "sent" | "whatsapp" | "replies" | "meetings") => rows.reduce((t, r) => t + (k === "sent" ? emailsOf(r) : k === "whatsapp" ? whatsappOf(r) : (r[k] ?? 0)), 0);
  const wa = total("whatsapp");
  // emails and WhatsApp apart, each against its own goal. Emails: the week's key result (Settings), else the
  // daily goal times the working days so far for the people shown; WhatsApp: its daily goal the same way.
  const shownPeople = rows.length;
  const tiles: { label: string; value: number; target?: number; note?: string }[] = [
    // the week's key results are the team's: shown against the team's totals only
    { label: "Emails sent", value: total("sent"), target: (team && kr.sent) || goals.email * days * shownPeople || undefined, note: team && kr.sent ? "the week's goal" : `${goals.email} a day${team ? " each" : ""}, so far` },
    { label: "WhatsApp sent", value: wa, target: goals.whatsapp * days * shownPeople || undefined, note: `${goals.whatsapp} a day${team ? " each" : ""}, so far` },
    { label: "Replies", value: total("replies"), target: team ? kr.replies : undefined },
    { label: "Meetings", value: total("meetings"), target: team ? kr.meetings : undefined },
  ];
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">{period.label}</h1>
      <p className="mt-1 text-sm text-muted">{period.key === "week" ? `Since ${WEEKDAYS[startDay]} ${period.fromDay}.` : period.fromDay === period.toDay ? `${period.fromDay}.` : `${period.fromDay} to ${period.toDay}.`}{step ? ` Hours are rounded to ${step} minutes per shift.` : ""} A reply or meeting counts for the person who sent that lead. Any answer counts as a reply, including &ldquo;not interested&rdquo;.</p>
      <PeriodPicker period={period} steps={steps} />
      {dataFrom && period.fromDay < dataFrom ? <p data-data-from className="mt-2 text-sm text-muted">Peek&apos;s data starts on {dataFrom}, so this period shows only what came after it.</p> : null}
      <GoalsNudge role={who.role} keyResults={keyResults} className="mt-4" />
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
        <span className="text-muted"> (a later note to a lead already sent; counted in the emails and WhatsApp above, as on the Clock)</span>
      </p>
      <p data-drafts-fixed className="mt-1 text-sm">
        <span className="text-muted">Drafts fixed: </span>
        <span className="font-semibold tabular-nums">{fixedTotal}</span>
        {can(who.role, "week.team") && fixedShown.length ? <span className="text-muted"> · {fixedShown.map(([n, c]) => `${n} ${c}`).join(" · ")}</span> : null}
        <span className="text-muted"> (an agent&apos;s email or WhatsApp draft a person rewrote: what the agents learn from)</span>
      </p>
      <div className="relative mt-6 overflow-x-auto">
      <table className="w-full min-w-[44rem] text-sm tabular-nums">
        <thead>
          <tr className="text-left text-xs text-muted">
            <th className="py-2 font-normal">Person</th>
            <th className="py-2 text-right font-normal" title="Leads this person has taken and not yet sent or given back, right now">{period.current && period.weekStart ? "Taken" : "Taken now"}</th>
            <th className="py-2 text-right font-normal" title={`Emails sent, against ${goals.email} a day times ${days} working day${days === 1 ? "" : "s"} so far`}>
              Emails / goal
            </th>
            <th className="py-2 text-right font-normal" title={`WhatsApp messages sent, against ${goals.whatsapp} a day times ${days} working day${days === 1 ? "" : "s"} so far`}>
              WhatsApp / goal
            </th>
            <th className="py-2 text-right font-normal">Replies</th>
            <th className="py-2 text-right font-normal">Meetings</th>
            <th className="py-2 text-right font-normal">Clients</th>
            <th className="py-2 text-right font-normal">Clocked</th>
            <th className="py-2 font-normal"><span className="sr-only">Statement</span></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => (
            <tr key={r.userId}>
              <td className="py-2">
                {r.name} <span className="text-xs text-muted">{r.role}</span>
                {longOpen.get(r.userId) ? (
                  <Link data-long-open href={`/week/statement/${r.userId}?week=${weekStart(longOpen.get(r.userId)!.startedAt, startDay, tz)}`} className="block text-xs font-medium text-bad hover:underline">
                    Clock open {longOpen.get(r.userId)!.hours} hours: close it before approving
                  </Link>
                ) : null}
              </td>
              <td data-taken className="py-2 text-right">
                {taken.get(r.userId) ? (
                  <Link href={`/week/taken/${r.userId}`} className="inline-flex min-h-11 items-center justify-end text-accent-ink hover:underline" aria-label={`${taken.get(r.userId)} leads taken by ${r.name}: see the list`}>
                    {taken.get(r.userId)}
                  </Link>
                ) : (
                  0
                )}
              </td>
              <td data-emails className="py-2 text-right whitespace-nowrap">
                {emailsOf(r)} <span className="text-muted">/ {goals.email * days}</span>
              </td>
              <td data-whatsapp className="py-2 text-right whitespace-nowrap">
                {whatsappOf(r)} <span className="text-muted">/ {goals.whatsapp * days}</span>
              </td>
              <td className="py-2 text-right">{r.replies}</td>
              <td className="py-2 text-right">{r.meetings}</td>
              <td className="py-2 text-right">{r.clients}</td>
              <td className="py-2 text-right">{hhmm(r.minutes)}</td>
              <td className="py-2 pl-3 text-right">
                {period.weekStart ? (
                  <Link href={`/week/statement/${r.userId}?week=${period.weekStart}`} className="inline-flex min-h-11 items-center text-sm text-accent-ink hover:underline">
                    {approved.has(`${r.userId}:${period.weekStart}`) ? "Statement (approved)" : "Statement"}
                  </Link>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        Taken: the leads each person holds now (taken in Send next or the WhatsApp pack, not yet sent or given back); click the number for the list.
        Goals: {goals.email} emails and {goals.whatsapp} WhatsApp messages a day for each person
        (Settings → Company), times the {days} working day{days === 1 ? "" : "s"} so far in this period. A reply, meeting or client counts in the period it was first reached.
      </p>

      {!period.weekStart && weeks.length ? <WeekStatements weeks={weeks} rows={rows} approved={approved} /> : null}
      <HoursByProject rows={rows} shiftRows={shiftRows} projectList={projectList} end={end} />
    </div>
  );
}

/** A longer period's statements, week by week. An approved one keeps the figures it was approved with; this only links it. */
function WeekStatements({ weeks, rows, approved }: { weeks: string[]; rows: { userId: string; name: string }[]; approved: Set<string> }) {
  return (
    <section data-week-statements className="mt-8">
      <h2 className="text-lg font-semibold">Statements by week</h2>
      <p className="mt-1 text-sm text-muted">Pay is approved week by week. An approved statement keeps the figures it was approved with.</p>
      <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
        {[...weeks].reverse().map((w) => {
          const done = rows.filter((r) => approved.has(`${r.userId}:${w}`)).length;
          return (
            <li key={w}>
              <details>
                <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 px-3">
                  <span>Week of {w}</span>
                  <span className="text-xs text-muted tabular-nums">{done} of {rows.length} approved</span>
                </summary>
                <ul className="space-y-1 px-3 pb-2">
                  {rows.map((r) => (
                    <li key={r.userId}>
                      <Link href={`/week/statement/${r.userId}?week=${w}`} className="inline-flex min-h-11 items-center text-accent-ink hover:underline">
                        {r.name}: {approved.has(`${r.userId}:${w}`) ? "approved" : "draft"}
                      </Link>
                    </li>
                  ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Hours per project per person in the period (each person sees their own row; owner and managers see everyone's). */
function HoursByProject({ rows, shiftRows, projectList, end }: { rows: { userId: string; name: string }[]; shiftRows: (ProjectShift & { userId: string })[]; projectList: Project[]; end: Date }) {
  const per = new Map(rows.map((r) => [r.userId, minutesByProject(shiftRows.filter((s) => s.userId === r.userId), end)]));
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
