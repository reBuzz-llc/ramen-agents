import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { pageMe } from "@/lib/page-me";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { canSeePay } from "@/lib/rates";
import { statementFor } from "@/lib/statements";
import { hhmm } from "@/lib/timesheet";
import { startDayOf, weekStart } from "@/lib/week";

export const metadata = { title: "Statement · ramen-agents" };

const clock = (iso: string) => new Date(iso).toTimeString().slice(0, 5);
const weekday = (day: string) => new Date(`${day}T00:00:00`).toLocaleDateString("en-US", { weekday: "short" });
const money = (n: number | null, c: string) => (n === null ? "owner sets the rate" : `${c} ${n.toFixed(2)}`);

export default async function StatementPage(props: PageProps<"/week/statement/[userId]">) {
  const who = await pageMe();
  const { userId } = await props.params;
  const week = String((await props.searchParams).week ?? weekStart(new Date(), startDayOf(who.settings)));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week)) notFound();
  const d = await db();
  const [person] = await d.select().from(users).where(and(eq(users.tenantId, who.tenantId), eq(users.id, userId)));
  // Pay: yourself, the owner, and a manager for a member. Teammates never see each other's (the notice says so).
  if (!person || !canSeePay({ id: who.userId, role: who.role }, person)) notFound();
  const s = await statementFor(d, who.tenantId, userId, week);
  if (!s) notFound();
  const st = s.statement;
  const rows: [string, string][] = [
    ["Hours clocked", hhmm(s.week.minutes)],
    ["Base (hours x hourly rate)", money(st.base, st.currency)],
    ["Emails sent", String(s.week.sent)],
    ["WhatsApp messages sent", String(s.week.whatsapp ?? 0)],
    ["Replies, meetings, clients", `${s.week.replies}, ${s.week.meetings}, ${s.week.clients}`],
    ["Outcome bonus", money(st.bonus, st.currency)],
    ["Tasks done", String(s.week.tasksDone)],
    ["Total", money(st.total, st.currency)],
  ];
  return (
    <div className="max-w-xl">
      <Link href="/week" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent-ink hover:underline">
        ← This week
      </Link>
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Statement: {person.name || person.email}</h1>
      <p className="mt-1 text-sm text-muted">Week of {week} · {s.approved ? `approved by ${s.approved.by} on ${s.approved.at.slice(0, 10)} (frozen)` : "draft: it changes until approved"}</p>
      <table className="mt-6 w-full text-sm">
        <tbody className="divide-y divide-line">
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="py-2 text-muted">{k}</td>
              <td className={`py-2 text-right tabular-nums ${k === "Total" ? "font-semibold" : ""}`}>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {st.lines?.length ? (
        <table className="mt-4 w-full text-xs">
          <thead className="text-muted">
            <tr><th className="py-1 text-left font-normal">Project</th><th className="text-left font-normal">Days</th><th className="text-right font-normal">Hours</th><th className="text-right font-normal">Rate</th><th className="text-right font-normal">Base</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {st.lines.map((l) => (
              <tr key={`${l.project}${l.from}`}>
                <td className="py-1">{l.project}</td>
                <td>{l.from === l.to ? l.from : `${l.from} to ${l.to}`}</td>
                <td className="text-right tabular-nums">{l.hours.toFixed(2)}</td>
                <td className="text-right tabular-nums">{l.hourly === null ? "not set" : l.hourly.toFixed(2)}</td>
                <td className="text-right tabular-nums">{money(l.base, st.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {s.days.length ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold">Day by day</h2>
          <ul className="mt-2 space-y-3 text-xs">
            {s.days.map((d) => (
              <li key={d.day}>
                <div className="flex justify-between font-medium">
                  <span>{weekday(d.day)} {d.day}</span>
                  <span className="tabular-nums">{hhmm(d.minutes)}</span>
                </div>
                <ul className="mt-1 space-y-1 border-l border-line pl-3">
                  {d.shifts.map((sh) => (
                    <li key={sh.start}>
                      <span className="text-muted">{clock(sh.start)}–{sh.end ? clock(sh.end) : "now"} · {sh.project} · {hhmm(sh.minutes)}{sh.updates ? ` · ${sh.updates.met} of ${sh.updates.expected} updates` : ""}</span>
                      {sh.notes.map((n) => (
                        <p key={n.at} className="pl-3">{clock(n.at)} {n.text}</p>
                      ))}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {st.missing.length ? <p className="mt-3 text-xs text-muted">Not yet computed: {st.missing.join(" and ")} (Settings → People, or the company defaults).</p> : null}
      <div className="mt-6 flex gap-2">
        <a href={`/api/statement?user=${userId}&week=${week}&format=pdf`} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold hover:border-accent">Download PDF</a>
        {!s.approved && userId !== who.userId ? (
          <form action="/api/statement" method="post">
            <input type="hidden" name="user" value={userId} />
            <input type="hidden" name="week" value={week} />
            <button className="inline-flex min-h-11 items-center rounded-full bg-accent px-5 text-base font-semibold text-on-accent hover:bg-accent-hover">Approve and freeze</button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
