"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { BotEvent, BotProfile, BotState, Interest, Journal, Note, Questions } from "@/lib/bot";
import { describeStatus, TONE_DOT, TONE_TEXT, type Tone } from "@/lib/status";
import AppChrome from "./app-chrome";
import MachineView from "./machine-view";
import RunControl from "./run-control";
import ScreenshotViewer from "./screenshot-viewer";
import { useNow, usePoll } from "./hooks";
import { Icon, Panel, buttonClass } from "./ui";
import CopyButton from "./copy-button";
import { ago, clock } from "@/lib/format";
import type { BotMachine } from "@/lib/machine";
import type { Episode } from "@/lib/episodes";

const FAST_MS = 3000;
const MACHINE_MS = 5000;
const SLOW_MS = 15000;

function Meter({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const tone = pct >= 100 ? "bg-sys-red" : pct >= 75 ? "bg-sys-orange" : "bg-sys-blue";
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono tabular-nums text-ink">
          {value} / {max}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-fill">
        <div className={`h-full rounded-full ${tone} transition-[width] duration-500`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Row({ label, children, copy, what }: { label: string; children: React.ReactNode; copy?: string | null; what?: string }) {
  return (
    <div className="group grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 py-1.5 text-sm">
      <dt className="text-muted">{label}</dt>
      <dd className="flex min-w-0 items-start justify-between gap-2 text-ink">
        <span className="min-w-0 break-words">{children}</span>
        {copy ? <CopyButton text={copy} what={what ?? label.toLowerCase()} reveal className="-mt-0.5" /> : null}
      </dd>
    </div>
  );
}

const EVENT_STYLE: Record<string, { tone: Tone; label: string }> = {
  action: { tone: "good", label: "action" },
  rejected: { tone: "warn", label: "refused" },
  episode: { tone: "info", label: "episode" },
  journal: { tone: "info", label: "journal" },
  search_paused: { tone: "warn", label: "search paused" },
  watchdog: { tone: "bad", label: "watchdog" },
  quiet: { tone: "info", label: "quiet" },
  resume: { tone: "muted", label: "resume" },
  stop: { tone: "muted", label: "stop" },
  start: { tone: "muted", label: "start" },
  questions_retired: { tone: "muted", label: "tidy" },
  cycles_done: { tone: "muted", label: "done" },
};

function eventText(e: BotEvent): { main: string; sub?: string } {
  switch (e.kind) {
    case "action": {
      const failed = e.ok === "False";
      return { main: `${e.action}${failed ? " (failed)" : ""}: ${e.result ?? ""}`, sub: e.thought || undefined };
    }
    case "rejected":
      return { main: `${e.action} refused: ${e.reason ?? ""}`, sub: e.thought || undefined };
    case "episode":
      return { main: `Episode ${e.episode} began${e.question && e.question !== "None" ? `: “${e.question}”` : ""}` };
    case "journal":
      return { main: `Wrote a journal entry for episode ${e.episode} (${e.notes} notes)` };
    case "search_paused":
      return { main: `Search paused for ${Math.round(Number(e.minutes ?? 0))} minutes after a bot check` };
    case "watchdog":
      return { main: `Watchdog flagged ${e.problems ?? "a problem"}` };
    case "quiet":
      return { main: `Went quiet: ${e.reason ?? ""}` };
    case "resume":
      return { main: `Resumed episode ${e.episode} at ${e.actions} actions` };
    case "stop":
      return { main: `Stopped: ${e.reason ?? ""}` };
    case "questions_retired":
      return { main: `Retired ${e.duplicates} duplicate and ${e.stale} stale questions` };
    default:
      return { main: e.msg };
  }
}

const COLLAPSED_ITEMS = 4;

function ShowMore({ total, open, onToggle, noun }: { total: number; open: boolean; onToggle: () => void; noun: string }) {
  if (total <= COLLAPSED_ITEMS) return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className={`mt-3 ${buttonClass("tinted", "sm")}`}
    >
      {open ? "Show less" : `Show ${total - COLLAPSED_ITEMS} more ${noun}`}
      <svg viewBox="0 0 20 20" className={`h-3.5 w-3.5 text-muted transition-transform ${open ? "rotate-180" : ""}`} aria-hidden>
        <path d="M5.5 7.5 10 12l4.5-4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

/** What the copy button on an activity row copies: an episode's question on its own, otherwise the line
 * and the model's thought. */
function eventCopy(e: BotEvent, text: { main: string; sub?: string }): string {
  if (e.kind === "episode" && e.question && e.question !== "None") return e.question;
  return text.sub ? `${text.main}\n“${text.sub}”` : text.main;
}

function JournalView({ text }: { text: string }) {
  const [showAll, setShowAll] = useState(false);
  if (!text.trim()) return <p className="text-sm text-muted">Nothing written today yet.</p>;
  // Entries start with "## HH:MM title"; show the newest first.
  const entries = text
    .split(/\n(?=## )/)
    .filter((chunk) => chunk.startsWith("## "))
    .reverse();
  const shown = showAll ? entries : entries.slice(0, COLLAPSED_ITEMS);
  return (
    <div>
    <div className="space-y-5">
      {shown.map((chunk, i) => {
        const [heading, ...rest] = chunk.split("\n");
        return (
          <article key={i} className="group">
            <div className="mb-1.5 flex items-start justify-between gap-2">
              <h3 className="text-sm font-semibold text-ink">{heading.replace(/^##\s*/, "")}</h3>
              <CopyButton text={chunk.replace(/^##\s*/, "").trim()} what="journal entry" reveal />
            </div>
            {rest
              .join("\n")
              .trim()
              .split(/\n{2,}/)
              .map((para, j) => (
                <p key={j} className="mb-2 text-sm leading-relaxed break-words text-ink/85">
                  {para}
                </p>
              ))}
          </article>
        );
      })}
    </div>
    <ShowMore total={entries.length} open={showAll} onToggle={() => setShowAll((v) => !v)} noun={entries.length - COLLAPSED_ITEMS === 1 ? "entry" : "entries"} />
    </div>
  );
}

export default function Dashboard({ bot }: { bot: BotProfile }) {
  const base = `bots/${bot.slug}`;
  const now = useNow();
  const state = usePoll<BotState>(`${base}/state`, FAST_MS);
  const events = usePoll<BotEvent[]>(`${base}/events?n=80`, FAST_MS);
  const notes = usePoll<Note[]>(`${base}/notes`, SLOW_MS);
  const questions = usePoll<Questions>(`${base}/questions`, SLOW_MS);
  const interests = usePoll<Interest[]>(`${base}/interests`, SLOW_MS);
  const journal = usePoll<Journal>(`${base}/journal`, SLOW_MS);
  const machine = usePoll<BotMachine>(`${base}/machine`, MACHINE_MS);
  // The latest 10 whole episodes, kept loaded so a copy is instant (and works on iOS, which only copies
  // synchronously inside a tap). An older episode is fetched when its row is copied.
  const episodes = usePoll<Episode[]>(`${base}/episodes?limit=10`, SLOW_MS);

  // Remember this bot so the home page opens it next time.
  useEffect(() => {
    document.cookie = `bot=${bot.slug}; path=/; max-age=31536000; samesite=lax`;
  }, [bot.slug]);
  const [openNote, setOpenNote] = useState<number | null>(null);
  const [allNotes, setAllNotes] = useState(false);

  const s = state.data;
  const offline = state.error !== null;
  const status = describeStatus(s, offline);
  const hb = s?.heartbeat ?? null;
  const textOnly = s?.agent.browser === "tor";
  const loading = !s && !offline;
  // Newest first. Keys come from each line's own time and text (plus a counter for identical lines), not its
  // position, so a refresh that adds lines at the top does not rebuild every row and reset its copy button.
  const feed = (() => {
    const seen = new Map<string, number>();
    return (events.data ?? [])
      .filter((e) => e.kind)
      .map((e) => {
        const base = `${e.ts}|${e.kind}|${e.msg}`;
        const n = seen.get(base) ?? 0;
        seen.set(base, n + 1);
        return { e, key: `${base}|${n}` };
      })
      .reverse();
  })();
  const maxWeight = Math.max(1, ...(interests.data ?? []).map((i) => i.weight));
  const episodeText = (id: number): string | (() => Promise<string>) => {
    const known = episodes.data?.find((ep) => ep.id === id);
    if (known) return known.text;
    return async () => {
      const res = await fetch(`/api/${base}/episodes?id=${id}`, { cache: "no-store" });
      const list = (await res.json()) as Episode[];
      if (!res.ok || !list[0]) throw new Error("episode not found");
      return list[0].text;
    };
  };
  const latestEpisodesText = () =>
    (episodes.data ?? []).map((ep) => ep.text).join(`\n\n${"─".repeat(60)}\n\n`);

  return (
    <AppChrome
      bot={bot}
      section=""
      title={bot.name}
      subtitle={s ? `${s.agent.browser === "tor" ? "Text-only via Tor" : `${s.agent.mode === "web" ? "Web" : "Fake"} mode`} · ${s.agent.model}${s.pid ? ` · pid ${s.pid}` : ""}` : bot.bio || undefined}
      status={
        <span className="inline-flex items-center gap-2 rounded-full bg-panel py-1.5 pr-3.5 pl-3">
          <span className="relative flex h-2.5 w-2.5">
            {status.tone === "good" ? <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${TONE_DOT[status.tone]} opacity-60`} /> : null}
            <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${TONE_DOT[status.tone]}`} />
          </span>
          <span className={`text-sm font-semibold ${TONE_TEXT[status.tone]}`}>{loading ? "Connecting…" : status.label}</span>
          {s && hb ? <span className="text-xs text-muted">heartbeat {ago(hb.ts, now)}</span> : null}
        </span>
      }
      statusLine={
        <>
          <span className={`h-2 w-2 shrink-0 rounded-full ${TONE_DOT[status.tone]}`} />
          <span className={`font-semibold ${TONE_TEXT[status.tone]}`}>{loading ? "Connecting…" : status.label}</span>
          {s && hb ? <span className="min-w-0 truncate text-muted">heartbeat {ago(hb.ts, now)}</span> : null}
        </>
      }
      actions={
        <RunControl
          bot={bot}
          machine={machine.data}
          onChange={() => {
            machine.reload();
            state.reload();
            events.reload();
          }}
        />
      }
    >
      {offline ? (
        <div className="mb-5 rounded-xl bg-sys-red/10 p-4 text-sm">
          <p className="font-medium text-bad">Can’t reach {bot.name}’s data server on port {bot.port}.</p>
          <p className="mt-1 text-ink/80">{state.error} Start it, and this page reconnects on its own:</p>
          <div className="mt-2 flex items-center gap-2 rounded-lg bg-panel px-3 py-2">
            <pre className="min-w-0 flex-1 overflow-x-auto font-mono text-xs">cd ~/Projects/bot && .venv/bin/bot --config {bot.configPath} dashboard</pre>
            <CopyButton text={`cd ~/Projects/bot && .venv/bin/bot --config ${bot.configPath} dashboard`} what="command" />
          </div>
          <p className="mt-2 text-ink/80">Or start every bot’s data server at once from ~/bots/webapp with <code className="font-mono text-xs">npm run bots</code>.</p>
        </div>
      ) : null}

      {/* Stat tiles */}
      <div className="mb-5 grid grid-cols-3 gap-2.5 sm:gap-3 lg:grid-cols-6">
        {(
          [
            ["Notes", s?.counts.notes],
            ["Open questions", s?.counts.open_questions],
            ["Answered", s?.counts.answered_questions],
            ["Pages visited", s?.counts.visits, `/bots/${bot.slug}/visits`],
            ["Episodes", s?.counts.episodes],
            ["Actions", s?.counts.actions],
          ] as const
        ).map(([label, value, href]) => {
          const tile = (
            <>
              <div className="flex items-center gap-1 text-2xs font-semibold text-muted sm:text-xs">
                <span className="truncate">{label}</span>
                {href ? <Icon name="chevron-right" className="h-3 w-3 shrink-0 opacity-70" /> : null}
              </div>
              <div className="mt-0.5 font-rounded text-xl font-bold text-ink tabular-nums sm:text-2xl">{value ?? "–"}</div>
            </>
          );
          const box = "min-w-0 rounded-xl bg-panel px-3 py-2.5 sm:px-4 sm:py-3";
          return href ? (
            <Link key={label} href={href} className={`${box} pressable block hover:bg-fill-3`} aria-label={`${label}: ${value ?? "none"}. See the list`}>
              {tile}
            </Link>
          ) : (
            <div key={label} className={box}>
              {tile}
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Left column */}
        <div className="min-w-0 space-y-5">
          {bot.slug === "desk-agent" ? (
            <Panel title="Mac app" aside="Desk Agent.app">
              <p className="mb-3 text-sm text-muted">
                Install the Desk Agent app on this Mac so it can control your GUI apps. It runs in dry-run
                (plans, does nothing) until you turn that off.
              </p>
              <div className="flex items-center gap-3 [@media(pointer:coarse)]:hidden">
                <a href="/api/bots/desk-agent/download" download className={buttonClass("prominent")}>
                  Download the Mac app
                </a>
              </div>
              <p className="hidden text-sm text-muted [@media(pointer:coarse)]:block">
                Download on your Mac — a .dmg can’t be installed on iPhone or iPad.
              </p>
            </Panel>
          ) : null}

          <Panel title="What it last saw" aside={textOnly ? "text only" : s?.screenshot_at ? ago(s.screenshot_at, now) : "no screenshot"}>
            {textOnly ? (
              <p className="text-sm text-muted">
                This bot reads onion sites through Tor as plain text. It never loads images, so there is no picture;
                the current page and its activity are shown in the other panels.
              </p>
            ) : s ? (
              <ScreenshotViewer slug={bot.slug} screenshotAt={s.screenshot_at} />
            ) : (
              <p className="text-sm text-muted">No screenshot yet.</p>
            )}
          </Panel>

          <Panel title="Right now" aside={hb ? `cycle ${hb.cycle}` : undefined}>
            <p className={`mb-3 text-sm ${TONE_TEXT[status.tone]}`}>{status.detail}</p>
            <dl className="divide-y divide-line">
              <Row label="Question" copy={hb?.current_question} what="question">{hb?.current_question ?? <span className="text-muted">none</span>}</Row>
              <Row label="Page" copy={hb?.current_url} what="page address">
                {hb?.current_url ? (
                  <a href={hb.current_url} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
                    {hb.current_url}
                  </a>
                ) : (
                  <span className="text-muted">none</span>
                )}
              </Row>
              <Row label="Last action" copy={hb?.last_action} what="last action">{hb?.last_action ?? <span className="text-muted">none</span>}</Row>
              <Row label="Last progress">{ago(hb?.last_progress_at, now)}</Row>
              <Row label="Model failures">
                <span className={hb && hb.model_failures > 0 ? "text-bad" : ""}>{hb?.model_failures ?? "–"}</span>
              </Row>
              {s?.flags.length ? <Row label="Flags">{s.flags.join(", ")}</Row> : null}
            </dl>
            {s ? (
              <div className="mt-4 space-y-3">
                <Meter label={s.episode ? `Episode #${s.episode.id} actions` : "Episode actions"} value={s.episode?.actions ?? 0} max={s.budget} />
                <Meter label="Pages this hour" value={s.pages_last_hour} max={s.pages_per_hour} />
              </div>
            ) : null}
          </Panel>

          <Panel
            title="On this Mac"
            aside={
              machine.data && !machine.data.error
                ? `${machine.data.totals.processes} process${machine.data.totals.processes === 1 ? "" : "es"} · ${machine.data.totals.memMb >= 1024 ? `${(machine.data.totals.memMb / 1024).toFixed(1)} GB` : `${Math.round(machine.data.totals.memMb)} MB`}`
                : undefined
            }
          >
            <MachineView machine={machine.data} error={machine.error} />
          </Panel>

          <Panel
            title="Open questions"
            aside={
              questions.data ? (
                <span className="inline-flex items-center gap-1">
                  {questions.data.open.length > 12 ? `12 of ${questions.data.open.length} open` : `${questions.data.open.length} open`}
                  {questions.data.open.length ? (
                    <CopyButton text={() => (questions.data?.open ?? []).map((q) => `#${q.id} ${q.question}`).join("\n")} what="all open questions" />
                  ) : null}
                </span>
              ) : undefined
            }
          >
            <ul className="space-y-2.5">
              {(questions.data?.open ?? []).slice(0, 12).map((q) => (
                <li key={q.id} className="group flex items-start gap-3 text-sm">
                  <span className="shrink-0 font-mono text-xs text-muted">#{q.id}</span>
                  <span className="min-w-0 flex-1 break-words">{q.question}</span>
                  <CopyButton text={q.question} what="question" reveal className="-mt-0.5" />
                  {q.times_pursued > 0 ? (
                    <span className="shrink-0 text-xs text-muted" title="Times pursued">
                      ×{q.times_pursued}
                    </span>
                  ) : null}
                </li>
              ))}
              {questions.data && questions.data.open.length === 0 ? <li className="text-sm text-muted">No open questions.</li> : null}
            </ul>
          </Panel>

          <Panel title="Interests">
            <ul className="space-y-2">
              {(interests.data ?? []).slice(0, 15).map((i) => (
                <li key={i.topic}>
                  <div className="mb-0.5 flex justify-between gap-3 text-sm">
                    <span className="truncate">{i.topic}</span>
                    <span className="font-mono text-xs text-muted tabular-nums">{i.weight.toFixed(2)}</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-fill">
                    <div className="h-full rounded-full bg-sys-blue" style={{ width: `${Math.max(0, (i.weight / maxWeight) * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </Panel>
        </div>

        {/* Right column */}
        <div className="min-w-0 space-y-5">
          <Panel
            title="Activity"
            aside={
              events.at ? (
                <span className="inline-flex items-center gap-1">
                  live · updated {ago(new Date(events.at).toISOString(), now)}
                  {episodes.data?.length ? (
                    <CopyButton text={latestEpisodesText} what={`latest ${episodes.data.length} episode${episodes.data.length === 1 ? "" : "s"}`} />
                  ) : null}
                </span>
              ) : undefined
            }
          >
            <ol className="max-h-[280px] space-y-0 overflow-y-auto pr-1">
              {feed.map(({ e, key }) => {
                const style = EVENT_STYLE[e.kind ?? ""] ?? { tone: "muted" as Tone, label: e.kind ?? "log" };
                const text = eventText(e);
                return (
                  <li key={key} className="group grid grid-cols-[4.25rem_minmax(0,1fr)] items-baseline gap-x-2 gap-y-0.5 sm:grid-cols-[4.25rem_6.5rem_minmax(0,1fr)] border-b border-line/60 py-2 text-sm last:border-0">
                    <time className="font-mono text-xs text-muted tabular-nums">{clock(e.ts)}</time>
                    <span className={`flex items-center gap-1.5 text-xs font-medium ${TONE_TEXT[style.tone]}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${TONE_DOT[style.tone]}`} />
                      {style.label}
                    </span>
                    <div className="col-span-2 flex min-w-0 items-start gap-2 sm:col-span-1">
                      <div className="min-w-0 flex-1">
                        <p className="break-words">{text.main}</p>
                        {text.sub ? <p className="mt-0.5 break-words text-xs text-muted italic">“{text.sub}”</p> : null}
                      </div>
                      {e.kind === "episode" && /^\d+$/.test(e.episode ?? "") ? (
                        <CopyButton text={episodeText(Number(e.episode))} what={`episode ${e.episode}`} reveal className="-mt-0.5" />
                      ) : (
                        <CopyButton text={eventCopy(e, text)} what="activity" reveal className="-mt-0.5" />
                      )}
                    </div>
                  </li>
                );
              })}
              {events.data && feed.length === 0 ? <li className="text-sm text-muted">No activity logged yet.</li> : null}
            </ol>
          </Panel>

          <Panel title="Recent notes" aside={notes.data ? `${Math.min(notes.data.length, allNotes ? 15 : COLLAPSED_ITEMS)} of ${notes.data.length} latest` : undefined}>
            <ul className="divide-y divide-line">
              {(notes.data ?? []).slice(0, allNotes ? 15 : COLLAPSED_ITEMS).map((n) => {
                const open = openNote === n.id;
                return (
                  <li key={n.id} className="group relative py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-start gap-2">
                    <button type="button" onClick={() => setOpenNote(open ? null : n.id)} className="min-w-0 flex-1 text-left" aria-expanded={open}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 text-sm font-medium break-words">{n.title}</span>
                        <span className="shrink-0 text-xs text-muted">{ago(n.created_at, now)}</span>
                      </div>
                      <p className={`mt-1 text-sm break-words text-ink/75 ${open ? "" : "line-clamp-2"}`}>{n.body}</p>
                    </button>
                    <CopyButton text={`${n.title}\n\n${n.body}${n.source_url ? `\n\nSource: ${n.source_url}` : ""}`} what="note" reveal />
                    </div>
                    {open ? (
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                        {n.tags
                          .split(",")
                          .map((t) => t.trim())
                          .filter(Boolean)
                          .map((t) => (
                            <span key={t} className="rounded-full bg-panel-2 px-2 py-0.5 text-muted">
                              {t}
                            </span>
                          ))}
                        {n.source_url ? (
                          <a href={n.source_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                            source ↗
                          </a>
                        ) : null}
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <ShowMore total={Math.min(15, notes.data?.length ?? 0)} open={allNotes} onToggle={() => setAllNotes((v) => !v)} noun={Math.min(15, notes.data?.length ?? 0) - COLLAPSED_ITEMS === 1 ? "note" : "notes"} />
          </Panel>

          <Panel title="Today’s journal" aside={journal.data?.text.trim() ? <CopyButton text={journal.data.text} what="today’s journal" /> : undefined}>
            {journal.data ? <JournalView text={journal.data.text} /> : <p className="text-sm text-muted">Loading…</p>}
          </Panel>
        </div>
      </div>

      <footer className="mt-8 text-center text-xs text-muted">
        Read-only view. Data comes from {bot.name}’s own server on port {bot.port} and refreshes every few seconds.
      </footer>
    </AppChrome>
  );
}
