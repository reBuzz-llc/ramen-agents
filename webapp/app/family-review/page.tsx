import Link from "next/link";
import { hm, type Downtime, type Span } from "@/lib/downtime";
import { OUTPUT_TYPES, type Okr, type Window } from "@/lib/family-stats";
import type { Provider } from "@/lib/health";
import { Suspense } from "react";
import HealthBanner from "../health-banner";
import { familyReview, teamNumbers, type FamilyRow } from "@/lib/family-review";

export const metadata = { title: "Family review · Bot Dashboard" };

// The family review creatorCC used to build by hand (owner, 2026-10-28): read-only, from each bot's own files.
// Brand orange (#ff6600) for fills only, with near-black text on it; a refusal share over half is bold near-black, not red.
const BRAND = "#ff6600";
const ON_BRAND = "#1a0d00";
const SHORT: Record<string, string> = { lead: "lead", update_lead: "update", note: "note", task: "task", message: "msg", publish_package: "publish", package: "package", say: "say", ask: "ask" };

const pct = (x: number) => `${Math.round(x * 100)}%`;
const when = (ts: string | null) => (ts ? ts.replace("T", " ").slice(5, 16) : "—");

function Outputs({ w }: { w: Window }) {
  const parts = OUTPUT_TYPES.filter((t) => w.accepted[t]).map((t) => `${SHORT[t]} ${w.accepted[t]}`);
  return <span className="text-muted">{parts.length ? parts.join(" · ") : "none"}</span>;
}

function Row({ r, win }: { r: FamilyRow; win: "w7" | "w24" }) {
  const w = r.stats?.[win];
  const share = w?.refusedShare ?? 0;
  return (
    <tr className="align-top">
      <td className="py-2 pr-3">
        <span className="font-medium text-ink">{r.name}</span> <span className="font-mono text-xs text-muted">{r.handle}</span>
      </td>
      {w ? (
        <>
          <td className="py-2 pr-3 text-right tabular-nums">{w.actions}</td>
          <td className="py-2 pr-3 text-right tabular-nums">
            <span className={`whitespace-nowrap ${share > 0.5 ? "font-bold text-ink" : "text-muted"}`}>
              {w.refused} · {pct(share)}
            </span>
            <span className="mt-1 block h-1 rounded-full bg-fill-3" aria-hidden>
              <span className="block h-1 rounded-full" style={{ width: pct(share), background: BRAND }} />
            </span>
          </td>
          <td className="py-2 pr-3 text-xs">
            <Outputs w={w} />
          </td>
          <td className="py-2 pr-3 text-xs whitespace-nowrap text-muted tabular-nums">{when(r.stats!.lastAction)}</td>
          <td className="py-2 pr-3 text-xs whitespace-nowrap tabular-nums">
            {r.output ? (
              <span title={r.output.at ? `Last accepted ${r.output.label}: ${when(r.output.at)}` : `No accepted ${r.output.label} yet`} className={r.output.late ? "font-semibold text-bad" : "text-muted"}>
                {r.output.ago}
                <span className="block font-normal text-muted">{r.output.label}</span>
              </span>
            ) : (
              <span className="text-muted">—</span>
            )}
          </td>
        </>
      ) : (
        <td colSpan={5} className="py-2 pr-3 text-xs text-muted">
          Its database could not be read{r.error ? `: ${r.error}` : ""}.
        </td>
      )}
      <td className="py-2 pr-3 text-xs">
        {r.plan && r.plan.steps ? (
          <>
            <span className="block break-words text-ink">{r.plan.goal || "(untitled)"}</span>
            <span className="text-muted">
              {r.plan.done} of {r.plan.steps} steps{r.plan.activeMin !== null ? ` · ${r.plan.activeMin} min active` : ""}
              {r.plan.status !== "active" ? ` · ${r.plan.status}` : ""}
            </span>
          </>
        ) : (
          <span className="text-muted">no plan (a queue bot, or none yet)</span>
        )}
      </td>
      <td className="py-2 text-right text-xs tabular-nums">
        {r.stats ? (
          <>
            <span
              title={r.stats.crashes.last ? `Last: ${when(r.stats.crashes.last.ts)} ${r.stats.crashes.last.exception}: ${r.stats.crashes.last.message}` : "No run_loop_crashed event in the last 7 days."}
              className={r.stats.crashes[win] ? "font-bold text-ink" : "text-muted"}
            >
              {r.stats.crashes[win]}
            </span>
            {r.stats.crashes.last ? (
              <span className="block text-muted">
                last {when(r.stats.crashes.last.ts)} {r.stats.crashes.last.exception}
              </span>
            ) : null}
            <span className="block text-muted" title="Traceback blocks in launchd.err.log (a chained one counted once): untimed, a total since the file was created.">
              log {r.stats.crashes.total}
              {r.stats.crashes.since ? ` since ${r.stats.crashes.since.slice(5)}` : ""}
            </span>
          </>
        ) : null}
      </td>
    </tr>
  );
}

const spanText = (s: Span) => `${when(s.from)} to ${s.to.slice(0, 10) === s.from.slice(0, 10) ? s.to.slice(11, 16) : when(s.to)}`;

/** Mac off and bots quiet in the window, above the table, so a low day is not read as bad bots. */
function DowntimeLine({ d }: { d: Downtime }) {
  if (!d.off.length && !d.quiet.length) return <p className="mt-3 text-sm text-muted">No downtime in this window: the Mac was on and no quiet pause.</p>;
  const reasons = [...new Set(d.quiet.map((s) => s.note.replace(/^Steam is/, "Steam").trim()).filter(Boolean))];
  return (
    <p className="mt-3 rounded-lg border border-line px-3 py-2 text-sm text-muted">
      {d.off.length ? (
        <>
          <b className="text-ink">Mac off: {hm(d.offMin)}</b> ({d.off.map((s) => `${spanText(s)}, ${s.note}`).join("; ")})
        </>
      ) : (
        "Mac on throughout"
      )}
      {" · "}
      {d.quiet.length ? (
        <>
          <b className="text-ink">bots quiet: {hm(d.quietMin)}</b> ({reasons.join(", ") || "no reason logged"}
          {d.quiet.length > 1 ? `; ${d.quiet.map(spanText).join(", ")}` : ""})
        </>
      ) : (
        "no quiet pause"
      )}
      . Nothing could happen in those hours.
    </p>
  );
}

/** This week's objective and key results, with the Validator's progress line under each. */
function KeyResults({ okr }: { okr: Okr }) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-sm text-ink">
        <b>This week{okr.week ? ` (${okr.week})` : ""}:</b> {okr.objective || <span className="text-muted">no objective written</span>}
      </p>
      <ol className="mt-1 space-y-1 text-sm">
        {okr.krs.map((k, i) => (
          <li key={i}>
            <span className="text-ink">KR{i + 1}.</span> <span className="text-muted">{k.text || "(empty)"}</span>
            {k.progress ? <span className="block pl-8 text-xs text-ink">{k.progress}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Today's model providers: calls today and a dot, green answering, red failing, grey before the engine logs health. */
function Providers({ list }: { list: Provider[] }) {
  if (!list.length) return null;
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted">
      <span className="text-ink">Model providers today:</span>
      {list.map((p) => (
        <span key={p.host} className="whitespace-nowrap tabular-nums" title={p.ok === null ? "no health logged yet" : p.ok ? "answering" : "failing"}>
          <span aria-hidden className={`mr-1 inline-block h-2 w-2 rounded-full ${p.ok === null ? "bg-fill-3" : p.ok ? "bg-good" : "bg-bad"}`} />
          {p.host}: {p.calls}
          <span className="sr-only">{p.ok === null ? " (no health yet)" : p.ok ? " (answering)" : " (failing)"}</span>
        </span>
      ))}
    </p>
  );
}

/** The team's sending, streamed in after the table (a cold read of the Leads board takes a few seconds). */
async function Team({ okr, providers }: { okr: Okr | null; providers: Provider[] }) {
  const team = await teamNumbers();
  return (
    <section className="mt-5 rounded-xl bg-panel px-4 py-3">
      <h2 className="text-lg font-semibold text-ink">Team</h2>
      {team.ready ? (
        <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Email Sent</dt>
            <dd className="text-2xl font-semibold text-ink tabular-nums">{team.sent}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Drafts not sent yet</dt>
            <dd className="text-2xl font-semibold text-ink tabular-nums">{team.unsent ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Replies this week</dt>
            <dd className="text-2xl font-semibold text-ink tabular-nums">{team.repliesWeek}</dd>
          </div>
        </dl>
      ) : (
        <p className="mt-1 text-sm text-muted">{team.reason}</p>
      )}
      {okr ? <KeyResults okr={okr} /> : null}
      <Providers list={providers} />
    </section>
  );
}

/** The Validator's report is headings, one table and bullet lists: just enough markdown for that. */
function Report({ md }: { md: string }) {
  const out: React.ReactNode[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[\s:|-]+\|$/.test(lines[i])) rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      i--;
      const [head, ...body] = rows;
      out.push(
        <table key={i} className="my-2 w-full text-sm tabular-nums">
          <thead>
            <tr className="text-left text-xs text-muted">{head?.map((c, k) => <th key={k} className="py-1 pr-3 font-medium">{c}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {body.map((r, k) => (
              <tr key={k}>{r.map((c, j) => <td key={j} className="py-1 pr-3">{c}</td>)}</tr>
            ))}
          </tbody>
        </table>,
      );
    } else if (l.startsWith("# ")) out.push(<h3 key={i} className="mt-2 text-base font-semibold text-ink">{l.slice(2)}</h3>);
    else if (l.startsWith("## ")) out.push(<h4 key={i} className="mt-3 text-sm font-semibold text-ink">{l.slice(3)}</h4>);
    else if (l.startsWith("- ")) out.push(<p key={i} className="ml-3 text-xs break-words text-muted">• {l.slice(2)}</p>);
    else if (l.trim()) out.push(<p key={i} className="text-sm text-muted">{l}</p>);
  }
  return <>{out}</>;
}

export default async function FamilyReviewPage(props: { searchParams: Promise<{ w?: string; fresh?: string }> }) {
  const sp = await props.searchParams;
  const win = sp.w === "7d" ? "w7" : "w24";
  const data = await familyReview(sp.fresh === "1");
  const tab = (key: "24h" | "7d", label: string) => {
    const on = (key === "7d") === (win === "w7");
    return (
      <Link
        href={key === "24h" ? "/family-review" : "/family-review?w=7d"}
        className="rounded-full px-3 py-1 text-sm font-medium"
        style={on ? { background: BRAND, color: ON_BRAND } : undefined}
        aria-current={on ? "page" : undefined}
      >
        {label}
      </Link>
    );
  };
  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <Suspense fallback={null}>
        <HealthBanner className="mb-4" />
      </Suspense>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/work-plan" className="text-sm text-muted hover:text-ink">
            ← Work plan
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-ink">Family review</h1>
          <p className="text-sm text-muted">
            Every running agent, from its own database and logs (stopped ones left out). Read at {new Date(data.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            {" · "}
            <Link href={`/family-review?${win === "w7" ? "w=7d&" : ""}fresh=1`} className="underline">
              read again
            </Link>
          </p>
        </div>
        <nav className="flex gap-1 rounded-full bg-panel p-1" aria-label="Window">
          {tab("24h", "Last 24 hours")}
          {tab("7d", "Last 7 days")}
        </nav>
      </div>

      <DowntimeLine d={data.down[win]} />

      <section className="mt-3 overflow-x-auto rounded-xl bg-panel px-4 py-3">
        <table className="w-full min-w-[62rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1.5 pr-3 font-medium">Agent</th>
              <th className="py-1.5 pr-3 text-right font-medium">Actions</th>
              <th className="py-1.5 pr-3 text-right font-medium">Refused</th>
              <th className="py-1.5 pr-3 font-medium">Accepted outputs</th>
              <th className="py-1.5 pr-3 font-medium">Last action</th>
              <th className="py-1.5 pr-3 font-medium">Last output</th>
              <th className="py-1.5 pr-3 font-medium">Plan in hand</th>
              <th className="py-1.5 text-right font-medium">Crashes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {data.rows.map((r) => (
              <Row key={r.slug} r={r} win={win} />
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">
          Most refused first. Accepted outputs count leads, lead updates, notes, tasks, messages, packages, says and asks the
          rules let through. Last output is the bot&apos;s own kind (Lead Gen a lead, the Enricher a lead update, the Writer
          a draft, the Designer a package, the Analyst a note, The CEO a package or task), red past 24 h unless the Mac
          was off or the bots quiet for most of that time. Crashes in the window are the engine&apos;s run_loop_crashed events (written from engine e831f59 on,
          so a bot not restarted since shows 0); under them, the old untimed Traceback total in launchd.err.log since the
          date shown.
        </p>
      </section>

      <Suspense
        fallback={
          <section aria-busy="true" className="mt-5 h-24 animate-pulse rounded-xl bg-panel px-4 py-3">
            <span className="text-sm text-muted">Reading the Leads board…</span>
          </section>
        }
      >
        <Team okr={data.okr} providers={data.providers} />
      </Suspense>

      <section className="mt-5 rounded-xl bg-panel px-4 py-3">
        <h2 className="text-lg font-semibold text-ink">Validator&apos;s refusal report</h2>
        {data.report ? <Report md={data.report} /> : <p className="mt-1 text-sm text-muted">No report yet.</p>}
      </section>
    </main>
  );
}
