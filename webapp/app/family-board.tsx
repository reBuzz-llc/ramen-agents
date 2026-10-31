"use client";

import Link from "next/link";
import type { BotCard, Tone } from "@/lib/board";
import type { Board } from "@/lib/board-read";
import { useEffect, useState } from "react";
import { usePoll } from "./hooks";
import KeyResults from "./key-results";
import Portrait from "./portrait";
import World from "./world-view";

type View = "world" | "list";
const VIEW_KEY = "home-view";

const BRAND = "#ff6600";
const TONE: Record<Tone, { text: string; dot: string }> = {
  good: { text: "text-good", dot: "bg-good" },
  muted: { text: "text-muted", dot: "bg-fill-2" },
  warn: { text: "text-sys-orange", dot: "bg-sys-orange" },
  bad: { text: "text-bad", dot: "bg-bad" },
};
const pct = (x: number) => `${Math.round(x * 100)}%`;

/** The live family: the office world (owner, 10-30) or, as "List", one card per running bot with the stopped ones in a
 *  grey row; then the team line. No list of latest outputs (owner, 10-30): the world's speech bubbles carry them.
 *  Polls /api/board every 12 s while the tab is visible; the choice of view is remembered in this browser. */
export default function FamilyBoard({ initial }: { initial: Board | null }) {
  const poll = usePoll<Board>("board", 12000);
  const data = poll.data ?? initial;
  const [view, setView] = useState<View>("world");
  useEffect(() => {
    const t = setTimeout(() => {
      try {
        // a link into the room ("/#mailbox", "/#bulletin") shows the world whatever the remembered view
        if (localStorage.getItem(VIEW_KEY) === "list" && !/^#(mailbox|bulletin)$/.test(window.location.hash)) setView("list");
      } catch {
        /* private window: the world it is */
      }
    }, 0);
    return () => clearTimeout(t);
  }, []);
  const pick = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* not remembered */
    }
  };
  if (!data) return <p className="mt-6 text-sm text-muted">{poll.error ?? "Reading the family…"}</p>;
  const hour = new Date(data.at).getHours();
  return (
    <>
      <div className="mt-5 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          Live · read at {new Date(data.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          {poll.error ? <span className="text-bad"> · last refresh failed: {poll.error}</span> : null}
        </p>
        <div role="group" aria-label="View" className="flex shrink-0 rounded-full bg-fill-3 p-0.5 text-xs font-semibold">
          {(["world", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => pick(v)}
              aria-pressed={view === v}
              className="rounded-full px-3 py-1"
              style={view === v ? { background: BRAND, color: "#1a0d00" } : undefined}
            >
              {v === "world" ? "World" : "List"}
            </button>
          ))}
        </div>
      </div>
      {view === "world" ? <World data={data} /> : null}
      <div hidden={view !== "list"} className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {data.cards.map((c) => (
          <Card key={c.slug} c={c} hour={hour} />
        ))}
      </div>
      {view === "list" && data.stopped.length ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 rounded-lg bg-fill-3/50 px-3 py-2 text-xs text-muted">
          {data.stopped.map((s) => (
            <li key={s.slug}>
              <span className="font-medium">{s.name}</span>: stopped by the owner, since {s.since.slice(5)}
            </li>
          ))}
        </ul>
      ) : null}


      <section className="mt-6 rounded-xl bg-panel px-4 py-3">
        <h2 className="text-lg font-semibold text-ink">Team</h2>
        {data.team?.ready ? (
          <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted">Drafts waiting</dt>
              <dd className="text-2xl font-semibold text-ink tabular-nums">{data.team.unsent ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted" title="The Leads board has no sent date, so this is every row at Email Sent">
                Email Sent (all time)
              </dt>
              <dd className="text-2xl font-semibold text-ink tabular-nums">{data.team.sent}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Replies this week</dt>
              <dd className="text-2xl font-semibold text-ink tabular-nums">{data.team.repliesWeek}</dd>
            </div>
          </dl>
        ) : (
          <p className="mt-1 text-sm text-muted">{data.team ? data.team.reason : "Reading the Leads board…"}</p>
        )}
        {data.okr ? <KeyResults okr={data.okr} /> : null}
        <p className="mt-3 text-xs text-muted">
          <Link href="/settings/reports" className="underline">
            Reports
          </Link>{" "}
          has the refusal report and the model providers.
        </p>
      </section>
    </>
  );
}

function Card({ c, hour }: { c: BotCard; hour: number }) {
  const tone = TONE[c.state.tone];
  return (
    <article className="flex min-w-0 flex-col rounded-xl bg-panel px-4 py-3">
      <header className="flex items-center gap-2">
        <Portrait slug={c.slug} size={26} grey={c.state.word === "stalled" || c.state.word.startsWith("no heartbeat")} />
        <Link href={`/work-plan#${c.slug}`} className="min-w-0 flex-1 truncate font-semibold text-ink hover:underline">
          {c.name} <span className="font-mono text-xs font-normal text-muted">{c.handle}</span>
        </Link>
      </header>
      <p className={`mt-0.5 flex items-center gap-1.5 text-sm font-semibold ${tone.text}`}>
        <span aria-hidden className={`inline-block h-2 w-2 shrink-0 rounded-full ${tone.dot}`} />
        <span className="min-w-0 truncate">
          {c.state.word}
          {c.state.why ? <span className="font-normal text-muted"> · {c.state.why}</span> : null}
        </span>
      </p>
      <p className="mt-2 line-clamp-2 text-sm text-ink" title={c.on}>
        {c.on || <span className="text-muted">nothing written yet</span>}
      </p>
      <p className="mt-1 truncate text-xs text-muted" title={c.last?.words}>
        {c.last ? `${c.last.words}, ${c.last.ago}` : "no accepted action yet"}
      </p>
      <div className="mt-auto flex items-end justify-between gap-3 pt-3">
        <p className="text-xs text-muted tabular-nums">
          {c.output ? (
            <>
              <span className="text-base font-semibold text-ink">{c.output.today}</span> {c.output.label}
              {c.output.today === 1 ? "" : "s"} today
            </>
          ) : (
            <>{c.actionsToday} actions today</>
          )}
          {c.refusedShare !== null ? <span className="block">refused {pct(c.refusedShare)}</span> : null}
        </p>
        <Spark hours={c.hours} hour={hour} />
      </div>
    </article>
  );
}

/** Actions per hour today, midnight to now: one thin bar per hour, the current hour full colour. */
function Spark({ hours, hour }: { hours: number[]; hour: number }) {
  const shown = hours.slice(0, hour + 1);
  const max = Math.max(1, ...shown);
  const w = 4;
  const gap = 2;
  const h = 28;
  return (
    <svg width={24 * (w + gap)} height={h} role="img" aria-label={`Actions per hour today, ${shown.reduce((a, b) => a + b, 0)} in all`} className="shrink-0">
      {hours.map((n, i) => {
        const bh = i > hour ? 0 : Math.max(n ? 2 : 1, Math.round((n / max) * h));
        return (
          <rect key={i} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={1} fill={i > hour ? "transparent" : n ? BRAND : "currentColor"} opacity={i === hour || !n ? 1 : 0.55} className={n ? "" : "text-fill-3"}>
            <title>{`${String(i).padStart(2, "0")}:00 · ${n} action${n === 1 ? "" : "s"}`}</title>
          </rect>
        );
      })}
    </svg>
  );
}
