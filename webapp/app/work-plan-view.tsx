"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { BotSummary } from "@/lib/bot";
import type { Identity } from "@/lib/identity";
import { ago } from "@/lib/format";
import { summaryStatus, TONE_DOT } from "@/lib/status";
import type { CandidateFunnel } from "@/lib/candidates";
import type { Change } from "@/lib/changes";
import type { LeadResults, Pipeline, ResultGroup } from "@/lib/lead-results";
import type { TestRun } from "@/lib/test-runs";
import type { CeoMeasure } from "@/lib/ceo-measure";
import type { OwnerPlan, PastJob, RefusalDay, RefusalStats, Rule, WorkCard } from "@/lib/work-plan";
import { partition, pastLine, readHash, type Tab } from "@/lib/work-plan-rows";
import { sendJson } from "@/lib/client";
import { Avatar } from "./bot-switcher";
import { useLeaveGuard, useNow, usePoll } from "./hooks";
import PageShell from "./page-shell";
import { markWorkPlanSeen } from "./work-plan-shortcut";
import { compact, Segmented } from "./summary-parts";
import { buttonClass, Icon, Spinner } from "./ui";

const MAX_GOAL = 200;
const MAX_RULE = 160;
const MAX_RULES = 8;

const input =
  "h-9 w-full min-w-0 rounded-lg bg-fill-3 px-3 text-sm text-ink placeholder:text-muted focus:ring-2 focus:ring-sys-blue/40 focus:outline-none";

/** Minutes as "45m" or "2h 10m". */
const dur = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);

const same = (a: OwnerPlan, b: OwnerPlan) =>
  a.goal === b.goal && a.rules.length === b.rules.length && a.rules.every((r, i) => r.id === b.rules[i].id && r.text === b.rules[i].text);
const tidy = (p: OwnerPlan): OwnerPlan => ({ goal: p.goal.trim(), rules: p.rules.map((r) => ({ ...r, text: r.text.trim() })).filter((r) => r.text) });

/**
 * Every agent on one line (owner, 2026-09-26; folded 2026-10-30): tap a line for what it is working through now (the
 * engine's checklist) and the goal and rules the owner sets for it in one line each (read by the engine into every
 * step). Past jobs, the Leads numbers and the checks are their own tabs.
 */
export default function WorkPlanView({ identity }: { identity: Identity }) {
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
  const { running, stopped } = useMemo(() => partition(cards), [cards]);
  const slugs = useMemo(() => cards.map((c) => c.slug).join(" "), [cards]);

  // Folded rows, one open at a time (owner, 2026-10-30: "the Work plan page is too long"). The tab and the open row live
  // in the address: #past, #leads, #checks, or #<slug> (the world's nameplates link there).
  const [tab, setTab] = useState<Tab>("plan");
  const [open, setOpen] = useState<string | null>(null);
  const [showStopped, setShowStopped] = useState(false);
  useEffect(() => {
    const read = () => {
      const h = readHash(window.location.hash, slugs.split(" "));
      setTab(h.tab);
      if (h.open) {
        setOpen(h.open);
        if (stopped.some((c) => c.slug === h.open)) setShowStopped(true);
      }
    };
    const t = setTimeout(read, 0);
    window.addEventListener("hashchange", read);
    return () => {
      clearTimeout(t);
      window.removeEventListener("hashchange", read);
    };
  }, [slugs, stopped]);
  const go = (hash: string) => window.history.replaceState(window.history.state, "", hash ? `#${hash}` : window.location.pathname);
  const pickTab = (t: Tab) => {
    setTab(t);
    go(t === "plan" ? (open ?? "") : t);
  };

  return (
    <PageShell identity={identity} title="Work plan">
        <h1 className="pt-2 text-3xl font-bold text-ink">Work plan</h1>

        {feed.error && !feed.data ? <p className="mt-3 rounded-xl bg-sys-red/10 p-4 text-sm text-bad">{feed.error}</p> : null}
        {!feed.data && !feed.error ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted">
            <Spinner /> Loading…
          </p>
        ) : null}

        {feed.data ? (
          <>
            <div className="mt-3 mb-3">
              <Segmented label="Work plan section" options={TABS} value={tab} onChange={pickTab} />
            </div>
            {/* Every tab and row stays mounted and is only hidden, so an unsaved goal or target edit survives a switch. */}
            <div hidden={tab !== "plan"}>
              <p className="mb-2 text-xs text-muted">Each agent reads its goal and rules on its next step. “Can do” flips a card to what the agent can and cannot do.</p>
              <TargetPanel />
              <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {running.map((c) => (
                  <CardSlot key={c.slug} card={c} tone={status.get(c.slug)} target={open === c.slug} onDirty={markDirty} />
                ))}
              </ul>
              {stopped.length ? (
                <div className="mt-3">
                  <button type="button" onClick={() => setShowStopped((v) => !v)} className={buttonClass("plain", "sm")} aria-expanded={showStopped}>
                    {showStopped ? "Hide stopped" : `Show stopped (${stopped.length})`}
                  </button>
                  <ul className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3" hidden={!showStopped}>
                    {stopped.map((c) => (
                      <CardSlot key={c.slug} card={c} tone={status.get(c.slug)} target={open === c.slug} onDirty={markDirty} />
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>
            <div hidden={tab !== "past"}>
              <PastList jobs={feed.data.past ?? []} />
            </div>
            <div hidden={tab !== "leads"}>
              {feed.data.results ? <HowWeSend results={feed.data.results} /> : null}
              {feed.data.results ? <ResultsPanel results={feed.data.results} /> : null}
              {feed.data.candidates ? <CandidatesPanel funnel={feed.data.candidates} /> : null}
              {feed.data.tests?.length ? <TestRunsPanel runs={feed.data.tests} /> : null}
            </div>
            <div hidden={tab !== "checks"}>
              {feed.data.ceo ? <CeoPanel m={feed.data.ceo} /> : null}
              <RefusalPanel stats={feed.data.refusals ?? []} changes={feed.data.changes ?? []} />
            </div>
          </>
        ) : null}
    </PageShell>
  );
}

const TABS: { key: Tab; label: string }[] = [
  { key: "plan", label: "Work plan" },
  { key: "past", label: "Past jobs" },
  { key: "leads", label: "Leads" },
  { key: "checks", label: "Checks" },
];

/** A card in the grid, with its #slug anchor: the address /work-plan#<slug> (the world's nameplates) scrolls to it and
 *  outlines it. Keyed on the saved values: a change to the file starts the card afresh, while polls that bring the same
 *  values leave an edit in progress alone. */
function CardSlot({ card, tone, target, onDirty }: { card: WorkCard; tone?: ReturnType<typeof summaryStatus>; target: boolean; onDirty: (slug: string, on: boolean) => void }) {
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (target) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [target]);
  return (
    <li ref={ref} id={card.slug} className={`min-w-0 scroll-mt-24 rounded-xl ${target ? "ring-2 ring-[#ff6600]" : ""}`}>
      <AgentCard key={JSON.stringify(card.owner)} card={card} tone={tone} onDirty={onDirty} />
    </li>
  );
}

/** Past jobs, one line each, newest first, 20 at a time (owner, 2026-10-30): bot, task, when it ran, how it ended,
 *  active minutes. Tap a line for its steps. */
function PastList({ jobs }: { jobs: PastJob[] }) {
  const [shown, setShown] = useState(20);
  const [open, setOpen] = useState<number | null>(null);
  if (!jobs.length) return <p className="text-sm text-muted">No finished jobs yet.</p>;
  return (
    <>
      <ol className="divide-y divide-line rounded-xl bg-panel px-4">
        {jobs.slice(0, shown).map((j, i) => {
          const l = pastLine(j);
          return (
            <li key={i} className="py-2">
              <button type="button" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i} className="flex w-full items-baseline gap-3 text-left text-sm">
                <span className={`h-2 w-2 shrink-0 self-center rounded-full ${l.ended === "done" ? "bg-sys-green" : l.ended === "stuck" ? "bg-sys-orange" : "bg-sys-gray"}`} aria-hidden />
                <span className="w-24 shrink-0 truncate font-medium text-ink sm:w-32">{l.bot}</span>
                <span className="min-w-0 flex-1 truncate text-ink">{l.task}</span>
                <span className="hidden shrink-0 text-xs text-muted tabular-nums md:inline">{l.when}</span>
                <span className="w-16 shrink-0 text-right text-xs text-muted">{l.ended}</span>
                <span className="hidden w-28 shrink-0 text-right text-xs text-muted tabular-nums sm:inline">{l.active}</span>
              </button>
              {open === i ? (
                <div className="mt-1.5 ml-5 space-y-1 text-xs">
                  <p className="text-muted md:hidden">
                    {l.when} · {l.active}
                  </p>
                  {j.note ? <p className="break-words text-muted">{j.note}</p> : null}
                  {j.steps.map((st, k) => (
                    <p key={k} className={`break-words ${st.done ? "text-ink" : "text-muted"}`}>
                      {st.done ? "✓ " : "○ "}
                      {st.text}
                    </p>
                  ))}
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>
      {jobs.length > shown ? (
        <button type="button" onClick={() => setShown((n) => n + 20)} className={`${buttonClass("plain", "sm")} mt-2`}>
          More ({jobs.length - shown} older)
        </button>
      ) : null}
    </>
  );
}

type TargetDoc = { market: string; market_short: string; segment: string; trades: string; areas: string };
const TARGET_FIELDS: { key: keyof TargetDoc; label: string; hint: string }[] = [
  { key: "market", label: "Market", hint: "e.g. New York" },
  { key: "market_short", label: "Short name", hint: "e.g. NYC" },
  { key: "segment", label: "Segment", hint: "e.g. small businesses" },
  { key: "trades", label: "Trades", hint: "e.g. restaurants, shops, clinics" },
  { key: "areas", label: "Areas", hint: "e.g. Brooklyn, Manhattan, Queens" },
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
          `(the Overture places data covers New York City only). Save anyway?`,
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
    <details id="target" className="group mb-2 scroll-mt-24 rounded-xl bg-panel px-4 py-2.5">
      <summary className="flex cursor-pointer list-none items-center gap-3 text-sm">
        <Icon name="chevron-right" className="h-3.5 w-3.5 shrink-0 text-muted transition-transform group-open:rotate-90" />
        <span className="font-semibold text-ink">Target</span>
        <span className="min-w-0 flex-1 truncate text-muted">{saved ? [saved.market, saved.segment].filter(Boolean).join(" · ") || "not set" : "…"}</span>
      </summary>
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
    </details>
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

/** The team's sending routine, read once here instead of a board task that never closes (2026-10-10). The bots draft;
 * people send from the business mailbox. */
// The routine lives on the Leads board itself, in the board's description (owner, 2026-10-10); rows are not assigned per person.
const SEND_GUIDE = "https://app.notion.com/p/3e3d905fccff80f1af6afe3c063ed179";

function HowWeSend({ results }: { results: LeadResults }) {
  const team = results.sending.team;
  return (
    <section className="mb-5 rounded-xl bg-panel px-4 pt-3.5 pb-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">How we send{team.length ? ` (${team.join(", ")})` : ""}</h2>
        {results.ready ? (
          <span className="text-xs text-muted tabular-nums">
            <span className="font-semibold text-ink">{results.sending.sent}</span> marked Email Sent ·{" "}
            <span className="font-semibold text-ink">{results.sending.repliesWeek}</span> answers in the last 7 days
          </span>
        ) : null}
      </header>
      <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-ink/90">
        <li>On the Leads board, filter to rows with a Draft email and an empty Status (WhatsApp statuses count as empty).</li>
        <li>Read the draft against the business&apos;s own site and fix anything wrong. A draft starting &quot;skip:&quot; needs nothing.</li>
        <li>Send it from Anna&apos;s mailbox to the row&apos;s Business email, as written (the first line is the subject if it starts &quot;Subject:&quot;).</li>
        <li>Set Status to &quot;Email Sent&quot;.</li>
        <li>
          When they answer, set Result (Replied, Meeting, Client, Not interested, Bounced) and Result date. This is the only way the
          family learns what works.
        </li>
      </ol>
      <p className="mt-2 text-xs text-muted">
        The CEO&apos;s daily task names that day&apos;s drafted businesses with links; finishing it is what counts. The full step-by-step is the{" "}
        <a href={SEND_GUIDE} target="_blank" rel="noreferrer" className="font-semibold text-accent hover:underline">
          Leads board&apos;s description
        </a>
        .
      </p>
    </section>
  );
}

const STAGES_SHOWN: { key: keyof Pipeline; label: string; who: string }[] = [
  { key: "leads", label: "On the board", who: "Lead Gen" },
  { key: "drafted", label: "Drafted", who: "Outreach Writer" },
  { key: "sent", label: "Sent", who: "the team" },
  { key: "replied", label: "Answered", who: "the business" },
  { key: "meeting", label: "Meeting", who: "the team" },
  { key: "client", label: "Client", who: "the team" },
];

/** How far the leads got, and where they pile up (owner, 2026-10-10: "how could this be better?"). A pipeline from the
 * board to a client, the first stage that stalls marked; then the same steps per source and per industry, so the
 * source whose leads answer shows itself. Sent and later come from the team's Status and Result; bots never set them. */
function ResultsPanel({ results }: { results: LeadResults }) {
  const p = results.pipeline;
  // The stall: the first stage that has nothing while the one before it has work waiting.
  const stall = STAGES_SHOWN.findIndex((s, i) => i > 0 && p[s.key] === 0 && p[STAGES_SHOWN[i - 1].key] > 0);
  // Before the first email goes out, the later columns are all zero: leave them out rather than show empty bars.
  const cols = STAGES_SHOWN.filter((s) => s.key === "leads" || s.key === "drafted" || p.sent > 0 || s.key === "sent");
  return (
    <section className="mb-5 rounded-xl bg-panel px-4 pt-3.5 pb-4">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold text-ink">Lead results</h2>
        <span className="text-xs text-muted">The team sets Status and Result on the Leads board; the bots never touch them.</span>
      </header>
      {!results.ready ? (
        <p className="mt-2 text-sm text-muted">{results.reason}</p>
      ) : (
        <>
          <ol className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-6">
            {STAGES_SHOWN.map((s, i) => (
              <li key={s.key} className={`rounded-lg px-3 py-2 ${i === stall ? "bg-sys-orange/15 ring-1 ring-sys-orange/50" : "bg-fill-3"}`}>
                <p className="text-[11px] text-muted">{s.label}</p>
                <p className={`text-2xl font-semibold tabular-nums ${i === stall ? "text-sys-orange" : "text-ink"}`}>{p[s.key].toLocaleString()}</p>
                <p className={`text-[11px] ${i === stall ? "font-semibold text-sys-orange" : "text-muted"}`}>{i === stall ? `waiting on ${s.who}` : s.who}</p>
              </li>
            ))}
          </ol>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
            {results.drafts ? (
              <span className="rounded-full bg-fill-3 px-2 py-0.5 text-muted tabular-nums">
                drafts: {results.drafts.skipped} skipped · {results.drafts.waiting} still to draft
              </span>
            ) : null}
            {results.whatsappDrafts !== null ? (
              <span className="rounded-full bg-fill-3 px-2 py-0.5 text-muted tabular-nums">WhatsApp drafts: {results.whatsappDrafts}</span>
            ) : null}
            {results.mapLinks !== null ? (
              <span className="rounded-full bg-fill-3 px-2 py-0.5 text-muted tabular-nums">
                map links: {results.mapLinks} of {results.total}
              </span>
            ) : null}
            {results.noted?.waiting ? (
              <span className="rounded-full bg-sys-orange/15 px-2 py-0.5 text-sys-orange tabular-nums" title={results.noted.titles.join("\n")}>
                {results.noted.waiting} noted by Lead Gen, not yet listed
              </span>
            ) : null}
            {results.whatsapp !== null ? (
              <span className="rounded-full bg-fill-3 px-2 py-0.5 text-muted tabular-nums">
                WhatsApp: {results.whatsapp} links · checked by hand {results.whatsappVerified} real, {results.whatsappFalse} false
              </span>
            ) : null}
          </div>
          <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <GroupTable title="By where the lead came from" groups={results.bySource} cols={cols} />
            <GroupTable title="By industry" groups={results.byIndustry} cols={cols} />
          </div>
        </>
      )}
    </section>
  );
}

function GroupTable({ title, groups, cols }: { title: string; groups: ResultGroup[]; cols: typeof STAGES_SHOWN }) {
  return (
    <div className="min-w-0">
      <h3 className="mb-1 text-xs font-semibold text-muted">{title}</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm tabular-nums">
          <thead>
            <tr className="text-[11px] text-muted">
              <th className="py-1 pr-2 text-left font-normal" />
              {cols.map((c) => (
                <th key={c.key} className="px-1.5 py-1 text-right font-normal whitespace-nowrap">
                  {c.key === "leads" ? "Leads" : c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {groups.map((g) => (
              <tr key={g.label}>
                <td className="py-1.5 pr-2 text-ink">{g.label}</td>
                {cols.map((c) => (
                  <td key={c.key} className={`px-1.5 py-1.5 text-right ${g[c.key] ? "text-ink" : "text-muted/60"}`}>
                    {g[c.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
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
          <span className="block truncate text-base font-semibold text-ink">{card.name}</span>
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
            {/* Progress, not estimate against actual (owner, 2026-10-15): steps ticked, how soon the first one was in
                active minutes (the engine's measure, pauses left out), and how many actions it has taken. */}
            <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
              <span>
                {plan.steps.filter((s) => s.done).length} of {plan.steps.length} steps
              </span>
              {plan.measured ? <span>· {plan.firstStepMin === null ? "no step yet" : `first step after ${dur(plan.firstStepMin)} active`}</span> : null}
              <span>
                · {plan.actionsEngine ?? plan.actions} action{(plan.actionsEngine ?? plan.actions) === 1 ? "" : "s"}
              </span>
              {plan.started ? <span>· started {ago(plan.started, now)}</span> : null}
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
                  {s.activeMin !== null ? (
                    <span className="mt-0.5 shrink-0 text-xs text-muted tabular-nums">
                      {dur(s.activeMin)} active{s.actionsEngine !== null ? ` · ${s.actionsEngine} actions` : ""}
                    </span>
                  ) : null}
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
