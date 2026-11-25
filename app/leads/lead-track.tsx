"use client";

import { useState } from "react";
import type { Track, TrackClear, TrackNode } from "@/lib/lead-track";
import type { Step } from "@/lib/lead-workflow";

const DOT: Record<TrackNode["state"], string> = {
  done: "bg-accent text-on-accent",
  current: "bg-accent text-on-accent ring-4 ring-accent/25",
  next: "border-2 border-accent bg-panel group-hover/node:bg-accent-tint",
  later: "border-2 border-line bg-panel",
  stopped: "bg-bad text-white",
};
const WORD: Record<TrackNode["state"], string> = {
  done: "text-ink",
  current: "font-semibold text-ink",
  next: "font-medium text-accent-ink",
  later: "text-muted",
  stopped: "font-semibold text-bad",
};
const SAID: Partial<Record<TrackNode["state"], string>> = { done: "done", current: "current", stopped: "ended here", later: "not yet" };

function Dot({ state }: { state: TrackNode["state"] }) {
  return (
    <span aria-hidden className={`relative z-[1] grid size-6 shrink-0 place-items-center rounded-full ${DOT[state]}`}>
      {state === "done" || state === "current" ? (
        <svg width={12} height={12} viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M2.5 6.5l2.5 2.5 4.5-5.5" />
        </svg>
      ) : state === "stopped" ? (
        <svg width={10} height={10} viewBox="0 0 10 10" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M2 2l6 6M8 2L2 8" />
        </svg>
      ) : null}
    </span>
  );
}

function Node({ n, reachedNext, last, busy, onStep }: { n: TrackNode; reachedNext: boolean; last: boolean; busy: boolean; onStep: (s: Step) => void }) {
  const body = (
    <>
      <Dot state={n.state} />
      <span className={`mt-1 block text-center text-xs leading-tight ${WORD[n.state]}`}>{n.label}</span>
    </>
  );
  return (
    <li className="relative min-w-0" aria-current={n.state === "current" ? "step" : undefined} data-track-node={n.state}>
      {last ? null : <span aria-hidden className={`absolute top-[11px] left-1/2 h-0.5 w-full ${reachedNext ? "bg-accent" : "bg-line"}`} />}
      {n.step ? (
        <button type="button" disabled={busy} onClick={() => onStep(n.step!)} aria-label={n.step.label} title={n.step.label} className="group/node relative flex min-h-11 w-full flex-col items-center rounded-lg disabled:cursor-not-allowed disabled:opacity-50">
          {body}
        </button>
      ) : (
        <span className="relative flex min-h-11 w-full flex-col items-center">
          {body}
          {SAID[n.state] ? <span className="sr-only">, {SAID[n.state]}</span> : null}
        </span>
      )}
    </li>
  );
}

/** The rarer actions: an ending (Lost, Bounced, False number) and clearing a status. Apart from the line, so neither is one stray tap. */
function More({ track, busy, onStep, onClear }: { track: Track; busy: boolean; onStep: (s: Step) => void; onClear: (c: TrackClear) => void }) {
  const [open, setOpen] = useState(false);
  if (!track.more.length && !track.clears.length) return <span aria-hidden className="size-11" />;
  const item = "flex min-h-11 w-full items-center px-3 text-left text-sm whitespace-nowrap hover:bg-accent-tint disabled:opacity-50";
  return (
    <div
      role="presentation"
      className="relative"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape" || !open) return;
        e.stopPropagation(); // Escape closes this menu, not the whole panel
        setOpen(false);
      }}
    >
      <button type="button" aria-expanded={open} aria-label={`More ${track.label} actions`} title="More" onClick={() => setOpen(!open)} className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-accent-tint hover:text-accent-ink">
        <svg width={18} height={18} viewBox="0 0 18 18" fill="currentColor" aria-hidden>
          <circle cx={3.5} cy={9} r={1.6} />
          <circle cx={9} cy={9} r={1.6} />
          <circle cx={14.5} cy={9} r={1.6} />
        </svg>
      </button>
      {open ? (
        <div data-track-menu className="absolute top-full right-0 z-20 min-w-44 overflow-hidden rounded-xl border border-line bg-panel py-1 shadow-lg">
          {track.more.map((s) => (
            <button
              key={s.key}
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onStep(s);
              }}
              className={`${item} ${s.tone === "bad" ? "text-bad" : ""}`}
            >
              {s.label}
            </button>
          ))}
          {track.more.length && track.clears.length ? <div className="my-1 border-t border-line" /> : null}
          {track.clears.map((c) => (
            <button
              key={c.field}
              type="button"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                onClear(c);
              }}
              className={`${item} text-muted`}
            >
              {c.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** One labelled progress line per channel: filled steps are done, the outlined orange ones can be pressed next. */
export default function LeadTracks({ tracks, busy, onStep, onClear }: { tracks: Track[]; busy: boolean; onStep: (s: Step) => void; onClear: (c: TrackClear) => void }) {
  return (
    <section aria-label="Status" data-lead-status className="mt-4 space-y-2 rounded-xl border border-line bg-panel px-3 py-2">
      {tracks.map((t) => (
        <div key={t.channel} data-track={t.channel} className="flex flex-wrap items-center">
          <h3 className="w-auto text-xs font-semibold text-muted sm:w-20 sm:shrink-0">{t.label}</h3>
          <ol aria-label={`${t.label} progress`} className="order-last grid w-full min-w-0 sm:order-none sm:w-auto sm:flex-1" style={{ gridTemplateColumns: `repeat(${t.nodes.length}, minmax(0, 1fr))` }}>
            {t.nodes.map((n, i) => {
              const after = t.nodes[i + 1]?.state;
              return <Node key={n.key} n={n} last={i === t.nodes.length - 1} reachedNext={after === "done" || after === "current"} busy={busy} onStep={onStep} />;
            })}
          </ol>
          <div className="ml-auto">
            <More track={t} busy={busy} onStep={onStep} onClear={onClear} />
          </div>
          {t.note ? <p className="order-last w-full text-xs text-muted">Also on this lead: {t.note}</p> : null}
        </div>
      ))}
    </section>
  );
}
