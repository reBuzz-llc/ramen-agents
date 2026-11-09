"use client";
// The public office's page: the dashboard's home, read-only. The world (screens, ticker, Director,
// Time-lapse, the member dialogue as information), the calm pause line and the Validator's tick line, then the Team tile.
// No chat, no "Needs a human", no decisions, no CEO proposals, no controls. Built by scripts/world-public-build.mjs.
import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import type { Board } from "@/lib/board-read";
import KeyResults from "@/app/key-results";
import World from "@/app/world-view";
import { useWorldState } from "./state";

function Lines({ trial, tick }: { trial: string | null; tick: { text: string; stale: boolean } | null }) {
  return (
    <div className="mt-3 space-y-2">
      {trial ? (
        <p role="status" data-trial="on" className="rounded-lg border border-line bg-panel px-3 py-2 text-sm text-muted">
          {trial}.
        </p>
      ) : null}
      {tick ? (
        tick.stale ? (
          <p role="alert" data-tick="stale" className="rounded-lg border-l-4 border-bad bg-bad/10 px-3 py-2 text-sm font-medium text-bad">
            {tick.text}
          </p>
        ) : (
          <p data-tick="ok" className="text-xs text-muted tabular-nums">
            {tick.text}
          </p>
        )
      ) : null}
    </div>
  );
}

function Team({ data }: { data: Board }) {
  return (
    <section className="mt-6 rounded-xl bg-panel px-4 py-3">
      <h2 className="text-lg font-semibold text-ink">Team</h2>
      {data.team?.ready ? (
        <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-xs text-muted">Drafts waiting</dt>
            <dd className="text-2xl font-semibold text-ink tabular-nums">{data.team.unsent ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Email Sent (all time)</dt>
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
    </section>
  );
}

function PublicOffice() {
  const { state, error } = useWorldState();
  const data = (state?.board ?? null) as Board | null;
  // the portal's Office page shows the frame only after this (its 10-second load check), and sizes it to the page; the message
  // carries no data, so any parent may read it
  const ready = !!data;
  useEffect(() => {
    if (!ready || window.parent === window) return;
    const say = () => window.parent.postMessage({ type: "world-ready", height: document.documentElement.scrollHeight }, "*");
    say();
    const ro = new ResizeObserver(say);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, [ready]);
  return (
    <main className="mx-auto max-w-[1400px] px-4 pt-3 pb-16">
      <h1 className="sr-only">The office, live</h1>
      <p className="text-xs text-muted">
        The office, live and read-only{state ? ` · updated ${new Date(state.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : ""}.
        {error ? <span className="ml-1 text-bad">{error}</span> : null}
      </p>
      {data ? (
        <>
          <World data={data} />
          <Team data={data} />
        </>
      ) : (
        <p className="mt-6 text-sm text-muted">{error ?? "Reading the office…"}</p>
      )}
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<PublicOffice />);
