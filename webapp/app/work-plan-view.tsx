"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BotSummary } from "@/lib/bot";
import type { Identity } from "@/lib/identity";
import { ago } from "@/lib/format";
import { summaryStatus, TONE_DOT } from "@/lib/status";
import type { CandidateFunnel } from "@/lib/candidates";
import type { Change } from "@/lib/changes";
import type { LeadResults, ResultGroup } from "@/lib/lead-results";
import type { TestRun } from "@/lib/test-runs";
import type { CeoMeasure } from "@/lib/ceo-measure";
import type { DetailItem, DetailKind, OwnerPlan, PastJob, RefusalDay, RefusalStats, Rule, WorkCard } from "@/lib/work-plan";
import { sendJson } from "@/lib/client";
import { Avatar } from "./bot-switcher";
import { PAGE_WIDTH } from "./chrome-shell";
import { useLeaveGuard, useNow, usePoll } from "./hooks";
import ProfileMenu from "./profile-menu";
import Sheet from "./sheet";
import { markWorkPlanSeen } from "./work-plan-shortcut";
import { compact } from "./summary-parts";
import { buttonClass, Icon, Spinner } from "./ui";

const MAX_GOAL = 200;
const MAX_RULE = 160;
const MAX_RULES = 8;

const input =
  "h-9 w-full min-w-0 rounded-lg bg-fill-3 px-3 text-sm text-ink placeholder:text-muted focus:ring-2 focus:ring-sys-blue/40 focus:outline-none";

/** Minutes as "45m" or "2h 10m". */
const dur = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);

/** Estimate against actual working time, as data (owner, 2026-09-30: "est time - actual time = useful data"):
 * "est 30m · actual 45m · 15m over", the difference red when over and green when under. */
function TimeTag({ spent, estimate, className = "" }: { spent: number | null; estimate: number | null; className?: string }) {
  if (spent === null && estimate === null) return null;
  const diff = spent !== null && estimate !== null ? estimate - spent : null;
  const parts = [
    estimate !== null ? `est ${dur(estimate)}` : null,
    spent !== null ? `actual ${dur(spent)}` : null,
    diff === null ? null : diff === 0 ? "on estimate" : diff > 0 ? `${dur(diff)} under` : `${dur(-diff)} over`,
  ].filter(Boolean);
  // Over the estimate in red, under (or on) it in green (owner, 2026-09-30); the estimate and actual stay grey.
  const tone = diff === null ? "" : diff < 0 ? "font-semibold text-bad" : "font-semibold text-good";
  const last = parts.length - 1;
  return (
    <span className={`shrink-0 text-muted tabular-nums ${className}`} title="Working time: gaps between the bot's actions, pauses over 5 minutes left out">
      {parts.map((p, i) => (
        <span key={i}>
          {i ? " · " : ""}
          <span className={diff !== null && i === last ? tone : ""}>{p}</span>
        </span>
      ))}
    </span>
  );
}

const same = (a: OwnerPlan, b: OwnerPlan) =>
  a.goal === b.goal && a.rules.length === b.rules.length && a.rules.every((r, i) => r.id === b.rules[i].id && r.text === b.rules[i].text);
const tidy = (p: OwnerPlan): OwnerPlan => ({ goal: p.goal.trim(), rules: p.rules.map((r) => ({ ...r, text: r.text.trim() })).filter((r) => r.text) });

/**
 * One grid of every agent (owner, 2026-09-26): what it is working through now (the engine's checklist), the goal and
 * rules the owner sets for it in one line each (read by the engine into every step), and a scoreboard of today's
 * accepted outputs against the tokens spent. Minimal on purpose: single-line inputs, no long text.
 */
export default function WorkPlanView({ identity, backHref, backLabel }: { identity: Identity; backHref: string; backLabel: string }) {
  const feed = usePoll<{ cards: WorkCard[]; updatedAt: string | null; past?: PastJob[]; refusals?: RefusalStats[]; candidates?: CandidateFunnel; changes?: Change[]; results?: LeadResults; tests?: TestRun[]; ceo?: CeoMeasure }>("work-plan", 15000);
  const fleet = usePoll<BotSummary[]>("bots", 15000);
  const status = useMemo(() => new Map((fleet.data ?? []).map((b) => [b.slug, summaryStatus(b)])), [fleet.data]);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const markDirty = useCallback((slug: string, on: boolean) => {
    setDirty((d) => {
      if (d.has(slug) === on) return d;
      const next = new Set(d);
      if (on) next.add(slug);
      else next.delete(slug);
      return next;
    });
  }, []);
  useLeaveGuard(dirty.size > 0, "You have unsaved goals or rules. Leave this page and lose them?");
  // Looking at this page is what clears the header's red dot: mark it seen now and while it stays open.
  useEffect(() => {
    markWorkPlanSeen();
    const t = setInterval(markWorkPlanSeen, 60000);
    return () => clearInterval(t);
  }, []);

  const cards = useMemo(() => feed.data?.cards ?? [], [feed.data]);
  // Best value first: outputs per million tokens, then outputs; a bot that spent nothing today sorts last.
  const board = useMemo(
    () =>
      [...cards].sort(
        (a, b) => (b.score.perMillion ?? -1) - (a.score.perMillion ?? -1) || b.score.outputs - a.score.outputs || a.name.localeCompare(b.name),
      ),
    [cards],
  );

  return (
    <>
      <header className="pt-safe fixed inset-x-0 top-0 z-30">
        <div className="scroll-edge-top pointer-events-none absolute inset-x-0 top-0 h-[calc(env(safe-area-inset-top)+5.5rem)]" aria-hidden />
        <div className={`relative mx-auto flex ${PAGE_WIDTH} items-center gap-2 px-3 pt-2 pb-2 sm:px-5`}>
          <div className="flex min-w-0 flex-1 items-center">
            <Link href={backHref} className="glass pressable flex h-11 min-w-0 items-center gap-1 rounded-full pr-4 pl-2.5 text-sm font-semibold text-ink">
              <Icon name="chevron-left" className="h-4 w-4 shrink-0" />
              <span className="truncate">{backLabel}</span>
            </Link>
          </div>
          <div className="hidden h-11 shrink-0 items-center px-5 text-base font-semibold text-ink sm:flex">Work plan</div>
          <div className="flex h-11 min-w-0 flex-1 items-center justify-end">
            <ProfileMenu identity={identity} />
          </div>
        </div>
      </header>

      <main className={`mx-auto ${PAGE_WIDTH} px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] pb-[calc(env(safe-area-inset-bottom)+2.5rem)] sm:px-6 sm:pb-10`}>
        <div className="mb-5 pt-2">
          <h1 className="text-3xl font-bold text-ink">Work plan</h1>
          <p className="mt-0.5 text-sm text-muted">What each agent is doing, the goal and rules you set for it, and how much it got done today.</p>
        </div>

        {feed.error && !feed.data ? <p className="rounded-xl bg-sys-red/10 p-4 text-sm text-bad">{feed.error}</p> : null}
        {!feed.data && !feed.error ? (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> Loading…
          </p>
        ) : null}

        {feed.data ? (
          <>
            <TargetPanel />
            {feed.data.ceo ? <CeoPanel m={feed.data.ceo} /> : null}
            <RefusalPanel stats={feed.data.refusals ?? []} changes={feed.data.changes ?? []} />
            {feed.data.results ? <ResultsPanel results={feed.data.results} /> : null}
            {feed.data.candidates ? <CandidatesPanel funnel={feed.data.candidates} /> : null}
            {feed.data.tests?.length ? <TestRunsPanel runs={feed.data.tests} /> : null}
            <Board rows={board} status={status} />
            <PastJobs jobs={feed.data.past ?? []} />
            <ul className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              {/* Same order as the scoreboard, so a row there and its card here line up. */}
              {board.map((c) => (
                <li key={c.slug} className="min-w-0">
                  {/* Keyed on the saved values: a change to the file (a save, or an edit elsewhere) starts the card afresh,
                      while polls that bring the same values leave an edit in progress alone. */}
                  <AgentCard key={JSON.stringify(c.owner)} card={c} tone={status.get(c.slug)} onDirty={markDirty} />
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </main>
    </>
  );
}

/** Today's scoreboard: every number opens what stands behind it. */
function Board({ rows, status }: { rows: WorkCard[]; status: Map<string, ReturnType<typeof summaryStatus>> }) {
  const [detail, setDetail] = useState<Opened | null>(null);
  return (
    <section className="rounded-xl bg-panel px-4 pt-3.5 pb-3">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Scoreboard · today</h2>
        <span className="text-xs text-muted">Tap a number to see what is behind it</span>
      </header>
      <Scoreboard rows={rows} status={status} onOpen={setDetail} />
      <DetailSheet opened={detail} onClose={() => setDetail(null)} />
    </section>
  );
}

/** Finished jobs, estimate against actual (owner, 2026-09-30: "est time - actual time = useful data for me"): a total
 * per agent on top, then each job, its steps one tap away. Red = over the estimate, green = under. */
function PastJobs({ jobs }: { jobs: PastJob[] }) {
  const [open, setOpen] = useState<number | null>(null);
  const diffCell = (est: number | null, act: number | null) => {
    if (est === null || act === null) return <span className="text-muted">–</span>;
    const d = est - act;
    return <span className={`font-semibold ${d < 0 ? "text-bad" : "text-good"}`}>{d === 0 ? "on est" : d > 0 ? `${dur(d)} under` : `${dur(-d)} over`}</span>;
  };
  const byAgent = new Map<string, { name: string; jobs: number; withEst: number; est: number; act: number; over: number; under: number }>();
  for (const j of jobs) {
    const a = byAgent.get(j.slug) ?? { name: j.name, jobs: 0, withEst: 0, est: 0, act: 0, over: 0, under: 0 };
    a.jobs++;
    if (j.estimateMin !== null && j.actualMin !== null) {
      a.withEst++;
      a.est += j.estimateMin;
      a.act += j.actualMin;
      if (j.actualMin > j.estimateMin) a.over++;
      else a.under++;
    }
    byAgent.set(j.slug, a);
  }
  return (
    <section className="mt-5 rounded-xl bg-panel px-4 pt-3.5 pb-3">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Past jobs</h2>
        <span className="text-xs text-muted">Estimate against actual working time</span>
      </header>
      {!jobs.length ? (
        <p className="mt-2 text-sm text-muted">No finished jobs yet. Each job lands here when its agent finishes it or ends it stuck, with its estimate and the time it really took.</p>
      ) : (
        <>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[34rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1.5 pr-3 font-medium">Agent</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Jobs</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Over / under</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Estimated</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Actual</th>
                  <th className="py-1.5 text-right font-medium">Difference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...byAgent.entries()].map(([slug, a]) => (
                  <tr key={slug}>
                    <td className="py-2 pr-3 font-medium text-ink">{a.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{a.jobs}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      <span className="text-bad">{a.over}</span> / <span className="text-good">{a.under}</span>
                    </td>
                    <td className="py-2 pr-3 text-right text-muted tabular-nums">{a.withEst ? dur(a.est) : "–"}</td>
                    <td className="py-2 pr-3 text-right text-muted tabular-nums">{a.withEst ? dur(a.act) : "–"}</td>
                    <td className="py-2 text-right tabular-nums">{a.withEst ? diffCell(a.est, a.act) : <span className="text-muted">no estimates</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ol className="mt-3 divide-y divide-line border-t border-line">
            {jobs.map((j, i) => (
              <li key={i} className="py-2">
                <button type="button" onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-start gap-3 text-left" aria-expanded={open === i}>
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${j.status === "done" ? "bg-sys-green" : j.status === "stuck" ? "bg-sys-orange" : "bg-sys-gray"}`} role="img" aria-label={j.status} />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm break-words text-ink">{j.task || "(untitled job)"}</span>
                    <span className="block text-xs text-muted">
                      {j.name} · {j.status}
                      {j.ended ? ` · ended ${j.ended.replace("T", " ").slice(0, 16)}` : ""}
                    </span>
                  </span>
                  <span className="shrink-0 text-right text-xs tabular-nums">
                    <span className="block text-muted">
                      {j.estimateMin !== null ? `est ${dur(j.estimateMin)} · ` : ""}
                      {j.actualMin !== null ? `actual ${dur(j.actualMin)}` : ""}
                    </span>
                    {diffCell(j.estimateMin, j.actualMin)}
                  </span>
                </button>
                {open === i ? (
                  <div className="mt-2 ml-5 space-y-1">
                    {j.note ? <p className="text-xs break-words text-muted">{j.note}</p> : null}
                    {j.steps.map((st, k) => (
                      <div key={k} className="flex items-start gap-2 text-xs">
                        <span className={`min-w-0 flex-1 break-words ${st.done ? "text-ink" : "text-muted"}`}>
                          {st.done ? "✓ " : "○ "}
                          {st.text}
                        </span>
                        <span className="shrink-0 text-muted tabular-nums">
                          {st.estimateMin !== null ? `est ${dur(st.estimateMin)} · ` : ""}
                          {st.actualMin !== null ? `actual ${dur(st.actualMin)} · ` : ""}
                        </span>
                        <span className="shrink-0 tabular-nums">{diffCell(st.estimateMin, st.actualMin)}</span>
                      </div>
                    ))}
                  </div>
                ) : null}
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

type TargetDoc = { market: string; market_short: string; segment: string; trades: string; areas: string };
const TARGET_FIELDS: { key: keyof TargetDoc; label: string; hint: string }[] = [
  { key: "market", label: "Market", hint: "e.g. Springfield" },
  { key: "market_short", label: "Short name", hint: "e.g. SPR" },
  { key: "segment", label: "Segment", hint: "e.g. small businesses" },
  { key: "trades", label: "Trades", hint: "e.g. restaurants, shops, clinics" },
  { key: "areas", label: "Areas", hint: "e.g. Downtown, Northside, Riverside" },
];

/** The family's target market, one line each (common-data/knowledge/target.toml): every agent's card follows it on its
 * next step, and Lead Gen's candidates come from that market's open-data feed when one is set up. */
function TargetPanel() {
  const [saved, setSaved] = useState<TargetDoc | null>(null);
  const [draft, setDraft] = useState<TargetDoc | null>(null);
  const [feeds, setFeeds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/target", { cache: "no-store" })
      .then((r) => r.json() as Promise<TargetDoc & { feeds?: string[] }>)
      .then(({ feeds: f, ...t }) => {
        if (!live) return;
        setSaved(t);
        setDraft(t);
        setFeeds(f ?? []);
      })
      .catch(() => live && setNotice({ ok: false, text: "Could not read the target." }));
    return () => {
      live = false;
    };
  }, []);
  const dirty = !!draft && !!saved && TARGET_FIELDS.some((f) => draft[f.key].trim() !== saved[f.key]);
  useLeaveGuard(dirty, "You have an unsaved target. Leave this page and lose it?");
  async function save() {
    if (!draft || !dirty || busy) return;
    const market = draft.market.trim();
    const hasFeed = feeds.some((f) => f.toLowerCase() === market.toLowerCase());
    // Ask before going busy: a Cancel must leave Save and Undo usable.
    if (
      !hasFeed &&
      !window.confirm(
        `There is no open-data feed for "${market}" yet, so Lead Gen's daily list will come from FreeSerp's index of business websites only ` +
          `(the Overture places data covers only the area its snapshot was built for). Save anyway?`,
      )
    )
      return;
    setBusy(true);
    const sent = await sendJson<TargetDoc & { error?: string }>("/api/target", "PUT", draft);
    if (sent.ok && sent.body) {
      setSaved(sent.body);
      setDraft(sent.body);
      setNotice({ ok: true, text: "Saved. Every agent follows the new target on its next step." });
    } else setNotice({ ok: false, text: sent.body?.error ?? sent.error ?? "request failed" });
    setBusy(false);
  }
  return (
    <section id="target" className="mb-5 scroll-mt-24 rounded-xl bg-panel px-4 pt-3.5 pb-4">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Target</h2>
        <span className="text-xs text-muted">Where the family works: the only place it is set</span>
      </header>
      {!draft ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading…
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {TARGET_FIELDS.map((f) => (
            <label key={f.key} className="block min-w-0">
              <span className="mb-1 block text-xs font-semibold text-muted">{f.label}</span>
              <input
                className={input}
                value={draft[f.key]}
                maxLength={200}
                placeholder={f.hint}
                onChange={(e) => setDraft((d) => (d ? { ...d, [f.key]: e.target.value } : d))}
                onKeyDown={(e) => e.key === "Enter" && void save()}
              />
            </label>
          ))}
        </div>
      )}
      {draft ? (
        <div className="mt-3 space-y-1.5 text-xs text-muted">
          {/* Whether Lead Gen gets a daily list of real businesses for this market (common-data/knowledge/candidate-feeds.toml). */}
          {feeds.some((f) => f.toLowerCase() === draft.market.trim().toLowerCase()) ? (
            <p className="text-good">
              ✓ Candidates feed: Lead Gen gets a daily list of real {draft.market.trim()} businesses from open data.
            </p>
          ) : (
            <p className="text-sys-orange">
              No candidates feed for “{draft.market.trim() || "this market"}”: Lead Gen would find businesses by web search only. Feeds exist for:{" "}
              {feeds.join(", ") || "none"}. A new one is a few lines in common-data/knowledge/candidate-feeds.toml.
            </p>
          )}
          {/* The agents' cards say {market} and friends instead of a place; this is what those words become. */}
          <p>
            In the agents&apos; cards: <code className="font-mono">{"{market}"}</code> = {draft.market || "–"} ·{" "}
            <code className="font-mono">{"{market_short}"}</code> = {draft.market_short || "–"} · <code className="font-mono">{"{segment}"}</code> ={" "}
            {draft.segment || "–"} · <code className="font-mono">{"{trades}"}</code> and <code className="font-mono">{"{areas}"}</code> = the lines above.
          </p>
        </div>
      ) : null}
      <div className="mt-3 flex min-h-9 items-center justify-end gap-3">
        {notice ? <span className={`min-w-0 flex-1 text-xs ${notice.ok ? "text-muted" : "text-bad"}`}>{notice.text}</span> : null}
        {dirty ? (
          <>
            <button type="button" onClick={() => setDraft(saved)} className={buttonClass("plain", "sm")} disabled={busy}>
              Undo
            </button>
            <button type="button" onClick={() => void save()} className={buttonClass("prominent", "sm")} disabled={busy}>
              {busy ? <Spinner small /> : null}
              Save
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}

function CeoStat({ label, value, prev, hint }: { label: string; value: number; prev: number; hint: string }) {
  return (
    <div className="rounded-lg bg-grouped-3 px-3 py-2.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-2xl font-bold text-ink tabular-nums">
        {value}
        <span className={`ml-2 text-xs font-semibold ${value > prev ? "text-good" : value < prev ? "text-bad" : "text-muted"}`}>
          {value > prev ? `▲ ${value - prev}` : value < prev ? `▼ ${prev - value}` : "="} vs last week
        </span>
      </p>
      <p className="text-[11px] text-muted">{hint}</p>
    </div>
  );
}

/** The CEO's two weekly numbers (owner, 2026-10-06): tasks the team finished, leads that answered. Tasks created
 * is deliberately not shown: it is activity, not result. This week large, the three before as small bars. */
function CeoPanel({ m }: { m: CeoMeasure }) {
  if (!m.ok) return null;
  const [now, ...before] = m.weeks;
  const max = Math.max(1, ...m.weeks.flatMap((w) => [w.tasksDone, w.leadsAnswered]));
  return (
    <section className="mb-5 rounded-xl bg-panel px-4 pt-3.5 pb-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">The CEO this week</h2>
        <span className="text-xs text-muted">How the CEO is measured · last 7 days</span>
      </header>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr_minmax(0,1.2fr)]">
        <CeoStat label="Tasks the team finished" value={now.tasksDone} prev={before[0]?.tasksDone ?? 0} hint={`Done by the team · ${m.openTasks} still open`} />
        <CeoStat label="Leads that answered" value={now.leadsAnswered} prev={before[0]?.leadsAnswered ?? 0} hint="Result reached Replied, Meeting or Client" />
        <div className="flex items-end gap-3 px-1" aria-label="Last four weeks">
          {[...m.weeks].reverse().map((w) => (
            <div key={w.from} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex h-14 items-end gap-0.5">
                <span className="w-3 rounded-sm bg-sys-blue/70" style={{ height: `${Math.max(2, (w.tasksDone / max) * 56)}px` }} title={`${w.tasksDone} tasks done`} />
                <span className="w-3 rounded-sm bg-sys-green" style={{ height: `${Math.max(2, (w.leadsAnswered / max) * 56)}px` }} title={`${w.leadsAnswered} leads answered`} />
              </div>
              <span className="text-[10px] text-muted tabular-nums">{w.from.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

const FIELD_LABEL: Record<string, string> = { email: "Email", location: "Location", industry: "Industry", company_size: "Company size" };

/** Lead Gen's test runs on the saved sites: decisions right out of the sites per run (newest first, the engine version
 * beside it), the trap result, and for the latest full run how each field scored. Run before a change goes live. */
function TestRunsPanel({ runs }: { runs: TestRun[] }) {
  const latest = runs.find((r) => r.full) ?? runs[0];
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return (
    <section className="mb-5 rounded-xl bg-panel px-4 pt-3.5 pb-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Lead Gen test runs</h2>
        <span className="text-xs text-muted">20 saved business sites with known answers · run before a change goes live</span>
      </header>
      <ul className="mt-2 divide-y divide-line">
        {runs.slice(0, 6).map((r) => {
          const right = r.decision.right ?? 0;
          const p = pct(right, r.sites);
          return (
            <li key={r.file} className="grid grid-cols-1 gap-1 py-2 text-sm sm:grid-cols-[9rem_6rem_minmax(0,1fr)_9rem] sm:items-center">
              <span className="text-muted tabular-nums">
                {r.at.slice(5, 16).replace("T", " ")} <span className="font-mono text-[11px]">{r.commit}</span>
              </span>
              <span className={`font-semibold tabular-nums ${p >= 80 ? "text-good" : p >= 50 ? "text-sys-orange" : "text-bad"}`}>
                {right}/{r.sites} right
              </span>
              <span className="text-xs text-muted">
                {r.decision.missed_lead ? `${r.decision.missed_lead} missed leads` : ""}
                {r.decision.false_lead ? ` · ${r.decision.false_lead} false leads` : ""}
                {r.decision.no_answer ? ` · ${r.decision.no_answer} no answer` : ""}
                {!r.full ? " · partial rerun" : ""}
                {r.provisional ? " · provisional (answers not yet checked)" : ""}
                {r.rule === "strict" ? " · strict rule (email + visible problem + target)" : r.rule === "lenient" ? " · lenient rule (email only)" : r.rule === "mixed" ? " · mixed rules (some sites strict, some email only)" : " · rule not recorded"}
              </span>
              <span className={`text-xs ${r.traps.total ? (r.traps.passed === r.traps.total ? "text-good" : "font-semibold text-bad") : "text-muted"}`}>
                {r.traps.total ? `trap ${r.traps.passed === r.traps.total ? "passed" : "FAILED"} (${r.traps.passed}/${r.traps.total})` : "no trap"}
              </span>
            </li>
          );
        })}
      </ul>
      {latest ? (
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 sm:grid-cols-4">
          {Object.entries(latest.fields).map(([field, s]) => {
            const total = Object.values(s).reduce((a, b) => a + b, 0) - (s.not_a_lead ?? 0);
            return (
              <div key={field}>
                <p className="text-xs text-muted">{FIELD_LABEL[field] ?? field}</p>
                {/* Right first: a run of honest blanks is safe but has found nothing yet. */}
                <p className="text-sm text-ink tabular-nums">
                  {total ? `${s.right ?? 0} of ${total} right` : "no lead to score"}
                  {total && (s.wrong ?? 0) + (s.invented ?? 0) ? <span className="text-bad"> · {(s.wrong ?? 0) + (s.invented ?? 0)} wrong</span> : null}
                </p>
                <p className="text-[11px] text-muted">
                  {[s.right && `${s.right} right`, s.honest_blank && `${s.honest_blank} blank`, s.wrong && `${s.wrong} wrong`, s.invented && `${s.invented} invented`, s.missed && `${s.missed} missed`]
                    .filter(Boolean)
                    .join(" · ") || "–"}
                </p>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

const FUNNEL = [
  { stage: "Emailed", tone: "bg-sys-blue/70" },
  { stage: "Replied", tone: "bg-sys-teal" },
  { stage: "Meeting", tone: "bg-sys-orange" },
  { stage: "Client", tone: "bg-sys-green" },
] as const;
const RANK: Record<string, number> = { Emailed: 1, Replied: 2, Meeting: 3, Client: 4 };

const reached = (g: ResultGroup, stage: string) =>
  Object.entries(g.byResult).reduce((n, [r, c]) => n + ((RANK[r] ?? 0) >= RANK[stage] && !r.startsWith("reached") ? c : 0), 0);
const lost = (g: ResultGroup) => (g.byResult["Not interested"] ?? 0) + (g.byResult["Bounced"] ?? 0);

function ResultGroupList({ title, groups }: { title: string; groups: ResultGroup[] }) {
  return (
    <div>
      <h3 className="mb-2 text-xs font-semibold text-muted">{title}</h3>
      <ul className="space-y-3">
        {groups.map((g) => (
          <li key={g.label}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
              <span className="min-w-0 truncate font-medium text-ink">{g.label}</span>
              <span className="text-xs text-muted tabular-nums">
                {g.leads} leads · {FUNNEL.map((f) => `${reached(g, f.stage)} ${f.stage.toLowerCase()}`).join(" · ")}
                {lost(g) ? ` · ${lost(g)} lost` : ""}
              </span>
            </div>
            <div className="mt-1 flex h-1.5 overflow-hidden rounded-full bg-fill-3">
              {/* Each segment is the leads that got exactly that far, so the bar reads left to right as progress. */}
              {FUNNEL.map((f, i) => {
                const n = reached(g, f.stage) - (FUNNEL[i + 1] ? reached(g, FUNNEL[i + 1].stage) : 0);
                return n > 0 ? <span key={f.stage} className={f.tone} style={{ width: `${(n / g.leads) * 100}%` }} title={`${n} got to ${f.stage.toLowerCase()}`} /> : null;
              })}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** How far the leads got (the team's Result column on the Leads board; bots never write it): per source and per
 * industry, the leads that reached emailed, replied, a meeting, a client. The business result, not the bots' activity. */
function ResultsPanel({ results }: { results: LeadResults }) {
  const contacted = results.bySource.reduce((n, g) => n + reached(g, "Emailed") + lost(g), 0);
  return (
    <section className="mb-5 rounded-xl bg-panel px-4 pt-3.5 pb-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Lead results</h2>
        <span className="flex flex-wrap items-center gap-x-3 text-xs text-muted">
          {FUNNEL.map((f) => (
            <span key={f.stage} className="flex items-center gap-1">
              <span className={`h-2 w-2 rounded-full ${f.tone}`} aria-hidden /> {f.stage}
            </span>
          ))}
        </span>
      </header>
      {!results.ready ? (
        <p className="mt-2 text-sm text-muted">{results.reason}</p>
      ) : (
        <>
          <p className="mt-1 text-xs text-muted">
            {results.total} leads on the board, {contacted} contacted so far. The team sets each lead&apos;s Result on the Leads board; the bots never
            touch it.
          </p>
          {results.drafts ? (
            <p className="mt-1 text-xs text-muted">
              First emails ({results.drafts.column}, written by the Outreach Writer, never sent):{" "}
              <span className="font-semibold text-ink tabular-nums">{results.drafts.drafted} drafted</span> ·{" "}
              <span className="tabular-nums">{results.drafts.skipped} skipped</span> ·{" "}
              <span className="tabular-nums">{results.drafts.waiting} waiting at {results.drafts.stage}</span>
            </p>
          ) : null}
          {results.noted ? (
            <p className={`mt-1 text-xs ${results.noted.waiting ? "text-sys-orange" : "text-muted"}`} title={results.noted.titles.join("\n")}>
              {results.noted.waiting
                ? `${results.noted.waiting} businesses Lead Gen noted with an email but has not listed yet${results.noted.oldest ? `, oldest from ${results.noted.oldest.slice(0, 10)}` : ""} (it finishes these first).`
                : "Every business Lead Gen noted with an email is on the board."}
            </p>
          ) : null}
          {results.whatsapp !== null ? (
            <p className="mt-1 text-xs text-muted">
              <span className="font-semibold text-ink tabular-nums">{results.whatsapp}</span> of {results.total} leads have a WhatsApp link (filled by Lead Gen or from a wa.me link on their own site)
              {results.whatsappVerified || results.whatsappFalse
                ? `; checked by hand in WhatsApp Web: ${results.whatsappVerified} real, ${results.whatsappFalse} false (cleared from the board)`
                : ""}
              .
            </p>
          ) : null}
          <div className="mt-3 grid grid-cols-1 gap-5 md:grid-cols-2">
            <ResultGroupList title="By where the lead came from" groups={results.bySource} />
            <ResultGroupList title="By industry (top 8)" groups={results.byIndustry} />
          </div>
        </>
      )}
    </section>
  );
}

/** Lead Gen's daily candidate lists, per source: offered, visited, turned into leads (owner, 2026-10-05: which source
 * pays off). A bar per step, as a share of what that source offered. */
function CandidatesPanel({ funnel }: { funnel: CandidateFunnel }) {
  if (!funnel.sources.length) return null;
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
  return (
    <section className="mb-5 rounded-xl bg-panel px-4 pt-3.5 pb-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Lead Gen&apos;s candidates</h2>
        <span className="text-xs text-muted">
          Last {funnel.files} daily list{funnel.files === 1 ? "" : "s"} · offered → visited → became a lead
        </span>
      </header>
      <ul className="mt-3 space-y-4">
        {funnel.sources.map((s) => (
          <li key={s.source}>
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <span className="text-sm font-medium text-ink">{s.source}</span>
              <span className="text-xs text-muted tabular-nums">
                {s.candidates.toLocaleString()} offered · {s.visited.toLocaleString()} visited ({pct(s.visited, s.candidates)}%) ·{" "}
                <span className="font-semibold text-good">{s.leads.toLocaleString()} leads</span> ({pct(s.leads, s.candidates)}% of offered,{" "}
                {pct(s.leads, s.visited)}% of visited)
              </span>
            </div>
            <div className="mt-1.5 space-y-1">
              {[
                { label: "visited", value: s.visited, tone: "bg-sys-blue/70" },
                { label: "leads", value: s.leads, tone: "bg-sys-green" },
              ].map((b) => (
                <div key={b.label} className="flex items-center gap-2">
                  <span className="w-12 shrink-0 text-[11px] text-muted">{b.label}</span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-fill-3">
                    <div className={`h-full rounded-full ${b.tone}`} style={{ width: `${pct(b.value, s.candidates)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">A lead counts when an accepted lead or lead fix names the business&apos;s site. FreeSerp joins from the next daily list.</p>
    </section>
  );
}

const REFUSAL_TARGET = 20; // percent: the clean-up's target (engine session, 2026-10-03)
const pctOf = (d: RefusalDay) => (d.allowed + d.refused ? Math.round((100 * d.refused) / (d.allowed + d.refused)) : null);

/** Refused / all actions per agent: today, the last seven days as small bars, and the top refusal reasons. The number
 * the owner judges the card-and-guardrail clean-up by; target under 20 %. Green at or under it, red above. */
function RefusalPanel({ stats, changes }: { stats: RefusalStats[]; changes: Change[] }) {
  if (!stats.length) return null;
  // Changes that touch a bot (or every bot), by day: marked under that day's bar so a jump has a visible cause.
  const changesFor = (slug: string, day: string) => changes.filter((c) => c.at.startsWith(day) && (c.bots.includes("*") || c.bots.includes(slug)));
  const week = new Set(stats[0]?.days.map((d) => d.day) ?? []);
  const recent = changes.filter((c) => week.has(c.at.slice(0, 10)));
  const rows = [...stats].sort((a, b) => (pctOf(b.week) ?? -1) - (pctOf(a.week) ?? -1));
  return (
    <section className="mb-5 rounded-xl bg-panel px-4 pt-3.5 pb-3">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Refusal rate</h2>
        <span className="text-xs text-muted">
          Share of each agent&apos;s actions refused · target under {REFUSAL_TARGET}% · safety-rule refusals (&ldquo;fence&rdquo;) counted apart
        </span>
      </header>
      <ul className="mt-2 divide-y divide-line">
        {rows.map((b) => {
          const today = pctOf(b.today);
          const week = pctOf(b.week);
          const tone = (p: number | null) => (p === null ? "text-muted" : p <= REFUSAL_TARGET ? "text-good" : "text-bad");
          return (
            <li key={b.slug} className="grid grid-cols-1 gap-2 py-2.5 sm:grid-cols-[10rem_7rem_10rem_minmax(0,1fr)] sm:items-center">
              <span className="font-medium text-ink">{b.name}</span>
              <span className="text-sm tabular-nums">
                <span className={`font-semibold ${tone(today)}`}>{today === null ? "–" : `${today}%`}</span> <span className="text-xs text-muted">today</span>
                <span className="block text-xs">
                  <span className={tone(week)}>{week === null ? "–" : `${week}%`}</span> <span className="text-muted">7 days</span>
                </span>
                {b.week.fence ? (
                  <span className="block text-[11px] text-muted" title="Refusals that are the safety rules working (a personal mailbox, an email not on the business's own site, a guessed value, a site that forbids bots). Not counted in the rate.">
                    fence: {b.week.fence} in 7 days
                  </span>
                ) : null}
              </span>
              {/* One bar per day, oldest first; its height is that day's refusal rate, the line is the target. */}
              <span className="relative flex h-8 items-end gap-1" aria-label={`Last seven days: ${b.days.map((d) => `${d.day} ${pctOf(d) ?? "no actions"}${pctOf(d) === null ? "" : "%"}`).join(", ")}`}>
                <span className="absolute inset-x-0 border-t border-dashed border-line" style={{ bottom: `${Math.round((REFUSAL_TARGET / 100) * 32)}px` }} aria-hidden />
                {b.days.map((d) => {
                  const p = pctOf(d);
                  const ch = changesFor(b.slug, d.day);
                  return (
                    <span key={d.day} className="relative flex h-full w-3 items-end">
                    {ch.length ? (
                      <span
                        className="absolute -bottom-2 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full bg-sys-blue"
                        title={ch.map((c) => `${c.at.slice(5, 16).replace("T", " ")} · ${c.what}`).join("\n")}
                        aria-label={`${ch.length} change${ch.length === 1 ? "" : "s"} on ${d.day}`}
                      />
                    ) : null}
                    <span
                      title={`${d.day}: ${p === null ? "no actions" : `${p}% refused (${d.refused} of ${d.allowed + d.refused})`}${d.fence ? `; ${d.fence} fence` : ""}`}
                      className={`w-3 rounded-sm ${p === null ? "bg-fill-3" : p <= REFUSAL_TARGET ? "bg-sys-green" : "bg-sys-red/80"}`}
                      style={{ height: `${Math.round(((p === null ? 6 : Math.max(6, p)) / 100) * 32)}px` }}
                    />
                    </span>
                  );
                })}
              </span>
              <span className="min-w-0 text-xs break-words text-muted">
                {b.reasons.length ? b.reasons.map((r) => `${r.reason} (${r.n})`).join(" · ") : "nothing refused this week"}
              </span>
            </li>
          );
        })}
      </ul>
      {recent.length ? (
        <div className="mt-3 border-t border-line pt-2.5">
          <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold text-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-sys-blue" aria-hidden /> Changes this week (the dots under the bars)
          </p>
          <ul className="space-y-0.5 text-xs text-muted">
            {recent.slice(0, 8).map((c, i) => (
              <li key={i} className="break-words">
                <span className="tabular-nums">{c.at.slice(5, 10)}</span> · <span className="text-ink/85">{c.what}</span>
                {c.bots.includes("*") ? "" : ` (${c.bots.join(", ")})`} <span className="opacity-70">· {c.by}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

type Opened = { slug: string; name: string; kind: DetailKind };

/** A scoreboard number as a button: tap it to see what stands behind it. */
function Num({ onClick, label, children, className = "" }: { onClick: () => void; label: string; children: React.ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} title={label} className={`pressable hit -mx-1.5 rounded-md px-1.5 tabular-nums underline decoration-line decoration-dotted underline-offset-4 hover:bg-fill-3 hover:decoration-current ${className}`}>
      {children}
    </button>
  );
}

const DETAIL_TITLE: Record<DetailKind, string> = { outputs: "Outputs today", refused: "Refused today", flags: "Validator flags (open)" };

function DetailSheet({ opened, onClose }: { opened: Opened | null; onClose: () => void }) {
  const [items, setItems] = useState<DetailItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const key = opened ? `${opened.slug}:${opened.kind}` : "";
  useEffect(() => {
    if (!opened) return;
    let live = true;
    fetch(`/api/work-plan/details?bot=${opened.slug}&kind=${opened.kind}`, { cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json()) as unknown;
        if (!live) return;
        if (r.ok && Array.isArray(body)) setItems(body as DetailItem[]);
        else setError((body as { error?: string })?.error ?? `HTTP ${r.status}`);
      })
      .catch((err: unknown) => live && setError(err instanceof Error ? err.message : "request failed"));
    return () => {
      live = false;
      setItems(null);
      setError(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one load per opened number
  }, [key]);
  const dot = { good: "bg-sys-green", bad: "bg-sys-red", warn: "bg-sys-orange" };
  return (
    <Sheet open={opened !== null} onClose={onClose} title={opened ? `${opened.name} · ${DETAIL_TITLE[opened.kind]}` : ""}>
      {error ? <p className="text-sm text-bad">{error}</p> : null}
      {!items && !error ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading…
        </p>
      ) : null}
      {items && !items.length ? <p className="text-sm text-muted">Nothing here yet today.</p> : null}
      {items?.length ? (
        <ol className="divide-y divide-line">
          {items.map((it, i) => (
            <li key={i} className="flex gap-3 py-2.5">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dot[it.tone]}`} aria-hidden />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3 text-xs text-muted">
                  <span className="font-mono">{it.kind}</span>
                  <span className="shrink-0 tabular-nums">{it.at.replace("T", " ").slice(0, 16)}</span>
                </div>
                <p className="mt-0.5 text-sm break-words text-ink">{it.title}</p>
                {it.detail ? <p className="mt-0.5 text-xs break-words text-muted">Why: {it.detail}</p> : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
      {items && items.length >= 100 ? <p className="mt-2 text-xs text-muted">Showing the latest 100.</p> : null}
    </Sheet>
  );
}

function Scoreboard({ rows, status, onOpen }: { rows: WorkCard[]; status: Map<string, ReturnType<typeof summaryStatus>>; onOpen: (o: Opened) => void }) {
  return (
    <div className="mt-2">
      <p className="text-xs text-muted">outputs = leads, lead fixes, tasks, packages, provider finds</p>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[38rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th className="py-1.5 pr-3 font-medium">Agent</th>
              <th className="py-1.5 pr-3 text-right font-medium">Outputs</th>
              <th className="py-1.5 pr-3 text-right font-medium">Refused</th>
              <th className="py-1.5 pr-3 text-right font-medium" title="The Validator's open findings: errors / warnings">Flags</th>
              <th className="py-1.5 pr-3 text-right font-medium">Tokens</th>
              <th className="py-1.5 text-right font-medium">Per 1M tokens</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((c) => {
              const st = status.get(c.slug);
              const refusedShare = c.score.allowed + c.score.refused ? c.score.refused / (c.score.allowed + c.score.refused) : 0;
              return (
                <tr key={c.slug}>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${st ? TONE_DOT[st.tone] : "bg-sys-gray"}`} role="img" aria-label={st?.label ?? "unknown"} />
                      <span className="truncate font-medium text-ink">{c.name}</span>
                      <span className="font-mono text-[11px] text-muted">{c.handle}</span>
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right font-semibold text-ink tabular-nums">
                    <Num onClick={() => onOpen({ slug: c.slug, name: c.name, kind: "outputs" })} label={`${c.name}: see today's ${c.score.outputs} outputs`}>
                      {c.score.outputs}
                    </Num>
                  </td>
                  <td className={`py-2 pr-3 text-right tabular-nums ${refusedShare > 0.5 ? "font-semibold text-bad" : "text-muted"}`} title={`${Math.round(refusedShare * 100)}% of today's actions refused`}>
                    <Num onClick={() => onOpen({ slug: c.slug, name: c.name, kind: "refused" })} label={`${c.name}: see today's ${c.score.refused} refused actions and why`}>
                      {c.score.refused}
                    </Num>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums" title={`${c.flags.errors} errors, ${c.flags.warns} warnings open`}>
                    <Num onClick={() => onOpen({ slug: c.slug, name: c.name, kind: "flags" })} label={`${c.name}: see the Validator's open flags`}>
                      <span className={c.flags.errors ? "font-semibold text-bad" : "text-muted"}>{c.flags.errors}</span>
                      <span className="text-muted"> / {c.flags.warns}</span>
                    </Num>
                  </td>
                  <td className="py-2 pr-3 text-right text-muted tabular-nums">{c.score.tokens === null ? "–" : compact(c.score.tokens)}</td>
                  <td className="py-2 text-right font-semibold text-ink tabular-nums">{c.score.perMillion === null ? "–" : c.score.perMillion}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function AgentCard({ card, tone, onDirty }: { card: WorkCard; tone?: ReturnType<typeof summaryStatus>; onDirty: (slug: string, on: boolean) => void }) {
  const [saved, setSaved] = useState<OwnerPlan>(card.owner);
  const [draft, setDraft] = useState<OwnerPlan>(card.owner);
  const [fresh, setFresh] = useState(0);
  const [back, setBack] = useState(false); // the back of the card: what this agent can and cannot do // a counter for new rules' temporary ids; the server assigns r1, r2, ...
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const now = useNow(60000);
  const dirty = !same(tidy(draft), saved);

  useEffect(() => onDirty(card.slug, dirty), [card.slug, dirty, onDirty]);

  async function save() {
    if (!dirty || saving) return;
    setSaving(true);
    setNotice(null);
    const sent = await sendJson<{ owner?: OwnerPlan; error?: string }>("/api/work-plan", "PUT", { bot: card.slug, ...tidy(draft) });
    if (sent.ok && sent.body?.owner) {
      setSaved(sent.body.owner);
      setDraft(sent.body.owner);
      setNotice({ ok: true, text: "Saved. The agent reads it on its next step." });
    } else {
      setNotice({ ok: false, text: sent.body?.error ?? sent.error ?? "request failed" });
    }
    setSaving(false);
  }

  const plan = card.plan;
  const doneSteps = plan ? plan.steps.filter((s) => s.done).length : 0;

  return (
    <article className="flex h-full flex-col rounded-xl bg-panel p-4">
      <header className="flex items-center gap-3">
        <span className="relative shrink-0">
          <Avatar bot={card} size="sm" />
          <span className={`absolute -right-0.5 -bottom-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-bg ${tone ? TONE_DOT[tone.tone] : "bg-sys-gray"}`} role="img" aria-label={tone?.label ?? "unknown"} />
        </span>
        <span className="min-w-0 flex-1">
          <Link href={`/bots/${card.slug}`} className="block truncate text-base font-semibold text-ink hover:underline">
            {card.name}
          </Link>
          <span className="block truncate text-xs text-muted">
            {card.score.outputs} output{card.score.outputs === 1 ? "" : "s"} today · {card.score.refused} refused
            {card.score.tokens !== null ? ` · ${compact(card.score.tokens)} tokens` : ""}
            {card.flags.errors + card.flags.warns ? ` · ${card.flags.errors + card.flags.warns} Validator flag${card.flags.errors + card.flags.warns === 1 ? "" : "s"}` : ""}
          </span>
        </span>
        <button
          type="button"
          onClick={() => setBack((b) => !b)}
          aria-pressed={back}
          title={back ? "Back to the work plan" : "What this agent can and cannot do"}
          className={`${buttonClass(back ? "tinted" : "plain", "sm")} shrink-0`}
        >
          <Icon name={back ? "check" : "info"} className="h-3.5 w-3.5" />
          {back ? "Plan" : "Can do"}
        </button>
      </header>

      {back ? (
        <CapabilityList caps={card.capabilities} />
      ) : (
      <>

      {/* The engine's checklist for the job in hand (workspace/plan.json). */}
      <section className="mt-4">
        <h3 className="mb-1.5 flex items-baseline justify-between gap-2 text-xs font-semibold text-muted">
          <span>Checklist</span>
          {plan && !(plan.status !== "active" && plan.workedSince > 0) ? (
            <span className="font-normal">
              {doneSteps}/{plan.steps.length} · {plan.status}
              {plan.updated ? ` · ${ago(plan.updated, now)}` : ""}
            </span>
          ) : null}
        </h3>
        {plan && plan.status !== "active" && plan.workedSince > 0 ? (
          // The plan ended and the bot kept working without a new one: show it as history, not as the job in hand
          // (Lead Gen read as "stuck" for a day while it listed 11 leads, 2026-09-30). The full record is in Past jobs.
          <p className="text-sm text-muted">
            No active plan. Last: “{plan.task || "untitled job"}”, {plan.status}
            {plan.updated ? ` ${ago(plan.updated, now)}` : ""}; {plan.workedSince} action{plan.workedSince === 1 ? "" : "s"} since.
          </p>
        ) : plan ? (
          <>
            <p className="text-sm font-medium break-words text-ink">{plan.task || "(untitled job)"}</p>
            {plan.doneWhen ? <p className="mt-0.5 text-xs break-words text-muted">Done when: {plan.doneWhen}</p> : null}
            {/* Working time (gaps between the bot's actions, pauses left out) against the bot's own estimate. */}
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <span>
                Job: <TimeTag spent={plan.spentMin} estimate={plan.estimateMin} className="inline" /> over {plan.actions} action{plan.actions === 1 ? "" : "s"}
              </span>
              {plan.started ? <span>· started {ago(plan.started, now)}</span> : null}
              {plan.estimateMin === null ? <span>· no estimate yet</span> : null}
            </p>
            {plan.note ? (
              <p className={`mt-1 rounded-md px-2 py-1 text-xs break-words ${plan.status === "stuck" ? "bg-sys-orange/10 text-sys-orange" : "bg-fill-3 text-muted"}`}>{plan.note}</p>
            ) : null}
            <ul className="mt-2 space-y-1">
              {plan.steps.map((s, i) => (
                <li key={i} className="flex items-start gap-2 text-sm">
                  <span
                    className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full ${s.done ? "bg-sys-green text-white" : "ring-1 ring-line"}`}
                    role="img"
                    aria-label={s.done ? "done" : "to do"}
                  >
                    {s.done ? <Icon name="check" className="h-2.5 w-2.5" /> : null}
                  </span>
                  <span className={`min-w-0 flex-1 break-words ${s.done ? "text-muted line-through" : "text-ink"}`}>{s.text}</span>
                  <TimeTag spent={s.spentMin} estimate={s.estimateMin} className="mt-0.5 text-xs" />
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="text-sm text-muted">No checklist yet. It appears once the agent starts a job on the new engine.</p>
        )}
      </section>

      {/* The owner's goal and rules for this agent (common-data/work-plan.json): one line each. */}
      <section className="mt-4 border-t border-line pt-3">
        <label className="mb-1.5 block text-xs font-semibold text-muted" htmlFor={`goal-${card.slug}`}>
          Future goal
        </label>
        {/* Wraps instead of scrolling sideways (owner, 2026-10-03); still one line of text: Enter saves, no newlines. */}
        <textarea
          id={`goal-${card.slug}`}
          className={`${input} h-auto resize-none py-2 leading-snug [field-sizing:content]`}
          rows={1}
          value={draft.goal}
          maxLength={MAX_GOAL}
          placeholder="One line: where this agent should be heading"
          onChange={(e) => setDraft((d) => ({ ...d, goal: e.target.value.replace(/\s*\n\s*/g, " ") }))}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void save();
            }
          }}
        />
        {card.selfGoal ? (
          <p className="mt-1 text-xs break-words text-muted">
            <span className="font-semibold text-ink/80">Its own goal:</span> {card.selfGoal}
          </p>
        ) : null}
        {card.personaGoal ? <p className="mt-1 text-xs break-words text-muted">In its persona: {card.personaGoal}</p> : null}

        <div className="mt-3 mb-1.5 flex items-center justify-between text-xs font-semibold text-muted">
          <span>Current rules</span>
          <span className="font-normal">
            {draft.rules.length}/{MAX_RULES}
          </span>
        </div>
        <ul className="space-y-1.5">
          {draft.rules.map((r: Rule, i) => (
            <li key={r.id} className="flex items-center gap-1.5">
              <input
                className={input}
                value={r.text}
                maxLength={MAX_RULE}
                aria-label={`Rule ${i + 1}`}
                placeholder="One line rule"
                onChange={(e) => setDraft((d) => ({ ...d, rules: d.rules.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) }))}
                onKeyDown={(e) => e.key === "Enter" && void save()}
              />
              <button
                type="button"
                onClick={() => setDraft((d) => ({ ...d, rules: d.rules.filter((_, j) => j !== i) }))}
                className="pressable hit grid h-9 w-9 shrink-0 place-items-center rounded-lg text-muted hover:bg-fill-3 hover:text-bad"
                aria-label={`Remove rule ${i + 1}`}
              >
                <Icon name="xmark" className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
        {draft.rules.length < MAX_RULES ? (
          <button type="button" onClick={() => {
              setDraft((d) => ({ ...d, rules: [...d.rules, { id: `new${fresh}`, text: "" }] }));
              setFresh((n) => n + 1);
            }} className={`${buttonClass("plain", "sm")} mt-1.5`}>
            <Icon name="plus" className="h-3.5 w-3.5" /> Add a rule
          </button>
        ) : null}
      </section>

      </>
      )}

      <footer className="mt-auto flex min-h-9 items-center justify-end gap-3 pt-3">
        {notice ? <span className={`min-w-0 flex-1 text-xs ${notice.ok ? "text-muted" : "text-bad"}`}>{notice.text}</span> : null}
        {dirty ? (
          <>
            <button type="button" onClick={() => setDraft(saved)} className={buttonClass("plain", "sm")} disabled={saving}>
              Undo
            </button>
            <button type="button" onClick={() => void save()} className={buttonClass("prominent", "sm")} disabled={saving}>
              {saving ? <Spinner small /> : null}
              Save
            </button>
          </>
        ) : null}
      </footer>
    </article>
  );
}

/** The back of a card: the agent's real skills and limits, so a goal or rule can be checked before it is saved. */
function CapabilityList({ caps }: { caps: WorkCard["capabilities"] }) {
  return (
    <section className="mt-4 [animation:menu-in_0.28s_var(--ease-spring)]">
      <p className={`mb-3 rounded-lg px-3 py-2 text-xs font-medium ${caps.state === "Running" ? "bg-sys-green/10 text-good" : "bg-sys-orange/10 text-sys-orange"}`}>{caps.state}</p>
      <h3 className="mb-1.5 text-xs font-semibold text-muted">Can do</h3>
      <ul className="space-y-1">
        {caps.can.map((c) => (
          <li key={c} className="flex items-start gap-2 text-sm text-ink">
            <Icon name="check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-good" />
            <span className="min-w-0 break-words">{c}</span>
          </li>
        ))}
      </ul>
      <h3 className="mt-3 mb-1.5 text-xs font-semibold text-muted">Cannot do</h3>
      <ul className="space-y-1">
        {caps.cannot.map((c) => (
          <li key={c} className="flex items-start gap-2 text-sm text-muted">
            <Icon name="xmark" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-bad" />
            <span className="min-w-0 break-words">{c}</span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">A goal or rule that needs something on the Cannot do list gets refused and wastes tokens. Read from its config.</p>
    </section>
  );
}
