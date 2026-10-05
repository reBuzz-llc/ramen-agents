"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BotProfile } from "@/lib/bot";
import type { Digest, Verdict } from "@/lib/digest";
import type { Episode } from "@/lib/episodes";
import type { Bucket, Group, RangeKey, SummaryData, TrailNode } from "@/lib/summary";
import { RANGE_COOKIE, SCOPE_COOKIE } from "@/lib/view-prefs";
import { sendJson } from "@/lib/client";
import { ago } from "@/lib/format";
import AppChrome from "./app-chrome";
import CopyButton from "./copy-button";
import FleetView from "./fleet-view";
import { useNow, useVisibleInterval } from "./hooks";
import Sheet from "./sheet";
import { Bars, compact, niceMax, RANGE_KEYS, Segmented, StatTiles } from "./summary-parts";
import { buttonClass, Icon, Panel, Spinner } from "./ui";

export type Scope = "bot" | "fleet";

const GROUP_META: Record<Group, { label: string; color: string; detail: string }> = {
  reading: { label: "Reading", color: "var(--viz-1)", detail: "search, open, follow, read" },
  writing: { label: "Writing", color: "var(--viz-2)", detail: "notes, questions, interests, journal" },
  output: { label: "Output", color: "var(--viz-3)", detail: "tasks, packages, providers, messages" },
  other: { label: "Other", color: "var(--viz-4)", detail: "rest and everything else" },
};
const GROUP_ORDER: Group[] = ["reading", "writing", "output", "other"];

function friendlyDomain(d: string): string {
  if (d === "raw") return "Own files (raw/)";
  if (/^127\.0\.0\.1:8888$/.test(d)) return "SearXNG search";
  return d.replace(/^www\./, "");
}


// ---------------------------------------------------------------------------------------------------------
// Activity chart: stacked columns by action group, with hover, legend and a table view


function ActivityChart({ buckets }: { buckets: Bucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(280, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, [table]);
  const totals = buckets.map((b) => GROUP_ORDER.reduce((a, g) => a + b.counts[g], 0));
  const max = niceMax(Math.max(1, ...totals));
  const H = W < 500 ? 200 : 240;
  const pad = { l: 36, r: 8, t: 10, b: 26 };
  const plotW = W - pad.l - pad.r;
  const plotH = H - pad.t - pad.b;
  const slot = plotW / buckets.length;
  const barW = Math.min(24, slot * 0.62);
  const y = (v: number) => pad.t + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(buckets.length / Math.max(3, Math.floor(W / 90)));
  const hb = hover !== null ? buckets[hover] : null;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
          {GROUP_ORDER.map((g) => (
            <li key={g} className="flex items-center gap-1.5" title={GROUP_META[g].detail}>
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: GROUP_META[g].color }} />
              {GROUP_META[g].label}
            </li>
          ))}
        </ul>
        <button type="button" onClick={() => setTable((v) => !v)} className={buttonClass("plain", "sm")} aria-pressed={table}>
          {table ? "Show chart" : "Show table"}
        </button>
      </div>

      {table ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1.5 font-semibold">Period</th>
                {GROUP_ORDER.map((g) => (
                  <th key={g} className="py-1.5 text-right font-semibold">
                    {GROUP_META[g].label}
                  </th>
                ))}
                <th className="py-1.5 text-right font-semibold">Refused</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {buckets.map((b) => (
                <tr key={b.start}>
                  <td className="py-1.5 text-ink">{b.label}</td>
                  {GROUP_ORDER.map((g) => (
                    <td key={g} className="py-1.5 text-right text-ink">
                      {b.counts[g]}
                    </td>
                  ))}
                  <td className="py-1.5 text-right text-muted">{b.refused}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={box} className="relative">
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} className="block max-w-full" role="group" aria-label="Actions per period, stacked by kind" onPointerLeave={(e) => e.pointerType === "mouse" && setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="fill-[var(--muted)] text-[11px] tabular-nums">
                  {compact(t)}
                </text>
              </g>
            ))}
            {buckets.map((b, i) => {
              const cx = pad.l + slot * i + slot / 2;
              let acc = 0;
              const segs = GROUP_ORDER.filter((g) => b.counts[g] > 0);
              return (
                <g key={b.start}>
                  {segs.map((g, j) => {
                    const v = b.counts[g];
                    const y0 = y(acc);
                    acc += v;
                    const y1 = y(acc);
                    const top = j === segs.length - 1;
                    const h = Math.max(0, y0 - y1 - (top ? 0 : 2)); // 2 px surface gap between segments
                    const r = top ? Math.min(4, h) : 0;
                    const x = cx - barW / 2;
                    const yTop = y1 + (top ? 0 : 2);
                    const d = r
                      ? `M${x},${yTop + h} V${yTop + r} Q${x},${yTop} ${x + r},${yTop} H${x + barW - r} Q${x + barW},${yTop} ${x + barW},${yTop + r} V${yTop + h} Z`
                      : `M${x},${yTop + h} V${yTop} H${x + barW} V${yTop + h} Z`;
                    return <path key={g} d={d} fill={GROUP_META[g].color} opacity={hover === null || hover === i ? 1 : 0.45} />;
                  })}
                  {i % labelEvery === 0 || i === buckets.length - 1 ? (
                    <text x={cx} y={H - 8} textAnchor="middle" className="fill-[var(--muted)] text-[11px]">
                      {b.label}
                    </text>
                  ) : null}
                  <rect
                    x={pad.l + slot * i}
                    y={pad.t}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${b.label}: ${totals[i]} actions`}
                    onPointerEnter={(e) => e.pointerType === "mouse" && setHover(i)}
                    onClick={() => setHover((h) => (h === i ? null : i))}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                    className="outline-none"
                  />
                </g>
              );
            })}
            <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="var(--viz-grid)" strokeWidth={1} />
          </svg>
          {hb && hover !== null ? (
            <div
              className="glass pointer-events-none absolute top-0 z-10 w-44 rounded-xl p-2.5 text-xs"
              style={{ left: `clamp(0px, calc(${((pad.l + slot * hover + slot / 2) / W) * 100}% - 5.5rem), calc(100% - 11rem))` }}
            >
              <div className="mb-1 font-semibold text-ink">{hb.label}</div>
              {GROUP_ORDER.map((g) => (
                <div key={g} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-muted">
                    <span className="h-0.5 w-3 rounded-full" style={{ background: GROUP_META[g].color }} />
                    {GROUP_META[g].label}
                  </span>
                  <span className="font-semibold text-ink tabular-nums">{hb.counts[g]}</span>
                </div>
              ))}
              <div className="mt-1 flex justify-between border-t border-line pt-1 text-muted">
                <span>Refused</span>
                <span className="tabular-nums">{hb.refused}</span>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}



// ---------------------------------------------------------------------------------------------------------
// Trail: questions → episodes → notes → tasks, with edges, path highlighting and a detail sheet

const COLUMNS: { kind: TrailNode["kind"]; label: string; icon: "question" | "flag" | "note" | "check" }[] = [
  { kind: "question", label: "Questions", icon: "question" },
  { kind: "episode", label: "Episodes", icon: "flag" },
  { kind: "note", label: "Notes", icon: "note" },
  { kind: "task", label: "Tasks", icon: "check" },
];

const TRAIL_CAP = 14;

type Line = { d: string; key: string; kind: string; from: string; to: string };

function Trail({ data, onOpen }: { data: SummaryData["trail"]; onOpen: (n: TrailNode) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  const [all, setAll] = useState(false);

  // Order nodes so connected ones sit near each other: episodes newest first, the rest follow them.
  const columns = useMemo(() => {
    const episodes = data.nodes.filter((n) => n.kind === "episode");
    const rank = new Map(episodes.map((e, i) => [e.id, i]));
    const firstEpisode = (id: string) => {
      const linked = data.edges.filter((e) => e.from === id || e.to === id).map((e) => (e.from === id ? e.to : e.from));
      return Math.min(...linked.map((l) => rank.get(l) ?? 999), 999);
    };
    return COLUMNS.map((c) => ({
      ...c,
      nodes: c.kind === "episode" ? episodes : data.nodes.filter((n) => n.kind === c.kind).sort((a, b) => firstEpisode(a.id) - firstEpisode(b.id)),
    })).map((c) => ({ ...c, total: c.nodes.length, nodes: all ? c.nodes : c.nodes.slice(0, TRAIL_CAP) }));
  }, [data, all]);
  const hidden = columns.some((c) => c.total > c.nodes.length);

  const connected = useMemo(() => {
    if (!focus) return null;
    const seen = new Set([focus]);
    const queue = [focus];
    while (queue.length) {
      const id = queue.shift()!;
      for (const e of data.edges) {
        const other = e.from === id ? e.to : e.to === id ? e.from : null;
        if (other && !seen.has(other)) {
          seen.add(other);
          queue.push(other);
        }
      }
    }
    return seen;
  }, [focus, data.edges]);

  const measure = useCallback(() => {
    const root = wrap.current;
    if (!root) return;
    const box = root.getBoundingClientRect();
    const at = (id: string) => root.querySelector<HTMLElement>(`[data-node="${id}"]`)?.getBoundingClientRect();
    const next = data.edges.flatMap((e): Line[] => {
      const a = at(e.from);
      const b = at(e.to);
      if (!a || !b) return [];
      if (e.kind === "answers") {
        // A note answering a question loops back left, above the episodes column.
        const x1 = a.left - box.left;
        const y1 = a.top + a.height / 2 - box.top;
        const x2 = b.right - box.left;
        const y2 = b.top + b.height / 2 - box.top;
        const mid = (x1 + x2) / 2;
        return [{ key: `${e.from}-${e.to}`, kind: e.kind, from: e.from, to: e.to, d: `M${x1},${y1} C${mid},${y1 - 26} ${mid},${y2 - 26} ${x2},${y2}` }];
      }
      const x1 = a.right - box.left;
      const y1 = a.top + a.height / 2 - box.top;
      const x2 = b.left - box.left;
      const y2 = b.top + b.height / 2 - box.top;
      const c = (x2 - x1) / 2;
      return [{ key: `${e.from}-${e.to}`, kind: e.kind, from: e.from, to: e.to, d: `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}` }];
    });
    setLines(next);
  }, [data.edges]);

  useLayoutEffect(() => {
    measure();
    const ro = new ResizeObserver(() => measure());
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, [measure, columns]);

  if (!data.nodes.length) return <p className="text-sm text-muted">No episodes in this period.</p>;

  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1">
      <div ref={wrap} className="relative grid min-w-[760px] grid-cols-4 gap-x-10" onPointerLeave={() => setFocus(null)}>
        <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" aria-hidden>
          {lines.map((l) => {
            const lit = connected ? connected.has(l.from) && connected.has(l.to) : false;
            const dim = connected && !lit;
            return (
              <path
                key={l.key}
                d={l.d}
                fill="none"
                stroke={l.kind === "answers" ? "var(--sys-green)" : lit ? "var(--sys-blue)" : "var(--muted)"}
                strokeOpacity={dim ? 0.08 : lit ? 0.9 : l.kind === "answers" ? 0.55 : 0.28}
                strokeWidth={lit ? 2 : 1.25}
              />
            );
          })}
        </svg>
        {columns.map((c) => (
          <div key={c.kind} className="relative min-w-0">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted">
              <Icon name={c.icon} className="h-3.5 w-3.5" />
              {c.label}
              <span className="font-normal">· {c.total}</span>
            </div>
            <ul className="space-y-1.5">
              {c.nodes.map((n) => {
                const dim = connected && !connected.has(n.id);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      data-node={n.id}
                      onPointerEnter={() => setFocus(n.id)}
                      onFocus={() => setFocus(n.id)}
                      onClick={() => onOpen(n)}
                      className={`pressable relative w-full rounded-lg bg-grouped-3 px-2.5 py-1.5 text-left text-xs transition-opacity hover:bg-fill-2 ${dim ? "opacity-35" : ""} ${connected?.has(n.id) && focus === n.id ? "ring-2 ring-sys-blue/60" : ""}`}
                    >
                      <span className="line-clamp-2 font-medium text-ink">{n.label}</span>
                      {n.kind === "question" ? (
                        <span className={`mt-0.5 block text-2xs font-semibold ${n.status === "answered" ? "text-good" : "text-muted"}`}>{n.detail}</span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
              {!c.nodes.length ? <li className="rounded-lg border border-dashed border-line px-2.5 py-2 text-xs text-muted">None in these episodes</li> : null}
            </ul>
          </div>
        ))}
      </div>
      {hidden || all ? (
        <button type="button" onClick={() => setAll((v) => !v)} className={`${buttonClass("plain", "sm")} mt-2`}>
          {all ? "Show less" : `Show all ${columns.reduce((a, c) => a + c.total, 0)} items`}
        </button>
      ) : null}
    </div>
  );
}


// ---------------------------------------------------------------------------------------------------------
// Recap: the AI-written digest of the period, with goal progress; every citation opens the trail item

const REF_KIND: Record<string, { label: string; icon: "question" | "flag" | "note" | "check" }> = {
  q: { label: "Question", icon: "question" },
  e: { label: "Episode", icon: "flag" },
  n: { label: "Note", icon: "note" },
  t: { label: "Task", icon: "check" },
};

export const VERDICT_STYLE: Record<Verdict, { label: string; className: string; icon: "check" | "sparkles" | "flag" | "info" }> = {
  "on track": { label: "On track", className: "bg-sys-green/12 text-good", icon: "check" },
  "some progress": { label: "Some progress", className: "bg-sys-blue/10 text-info", icon: "sparkles" },
  "off track": { label: "Off track", className: "bg-sys-orange/12 text-warn", icon: "flag" },
  "no activity": { label: "No activity", className: "bg-fill-3 text-muted", icon: "info" },
};

function RefChips({ refs, nodes, onOpen }: { refs: string[]; nodes: TrailNode[]; onOpen: (n: TrailNode) => void }) {
  if (!refs.length) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {refs.map((r) => {
        const kind = REF_KIND[r[0]];
        const node = nodes.find((n) => n.id === r);
        if (!kind) return null;
        return (
          <button
            key={r}
            type="button"
            disabled={!node}
            onClick={() => node && onOpen(node)}
            title={node ? node.label : "Not in this period's trail"}
            className="pressable inline-flex h-6 items-center gap-1 rounded-full bg-fill-3 px-2 text-2xs font-semibold text-ink hover:bg-fill-2 disabled:opacity-50"
          >
            <Icon name={kind.icon} className="h-3 w-3" />
            {kind.label} {r.slice(1)}
          </button>
        );
      })}
    </span>
  );
}

function RecapPanel({ bot, range, nodes, onOpen }: { bot: BotProfile; range: RangeKey; nodes: TrailNode[]; onOpen: (n: TrailNode) => void }) {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);
  const rangeLabel = RANGE_KEYS.find((r) => r.key === range)!.label;

  useEffect(() => {
    let live = true;
    fetch(`/api/bots/${bot.slug}/digest?range=${range}`, { cache: "no-store" })
      .then((r) => r.json() as Promise<{ digest: Digest | null }>)
      .then((b) => {
        if (!live) return;
        setDigest(b.digest);
        setLoaded(true);
        setNow(Date.now());
      })
      .catch(() => live && setLoaded(true));
    return () => {
      live = false;
    };
  }, [bot.slug, range]);

  async function write() {
    setWriting(true);
    setError(null);
    const sent = await sendJson<{ digest?: Digest; error?: string }>(`/api/bots/${bot.slug}/digest`, "POST", { range });
    if (sent.body?.digest) {
      setDigest(sent.body.digest);
      setNow(Date.now());
    } else setError(sent.body?.error ?? sent.error ?? "could not write the recap");
    setWriting(false);
  }

  // A clock that keeps ticking, so "Written 5m ago" and the stale warning move on while the page stays open.
  const ticking = useNow(60000);
  const clock = Math.max(now, ticking);
  const stale = digest && clock - new Date(digest.generatedAt).getTime() > 6 * 3600e3;
  const button = (
    <button type="button" onClick={() => void write()} disabled={writing} className={buttonClass(digest ? "gray" : "prominent", "sm")}>
      {writing ? <Spinner small /> : <Icon name="sparkles" className="h-3.5 w-3.5" />}
      {writing ? "Writing…" : digest ? "Rewrite" : "Write recap"}
    </button>
  );

  return (
    <Panel title="Recap" aside={digest ? button : undefined}>
      {!loaded ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner small /> Loading…
        </p>
      ) : !digest ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-2xl text-sm text-muted">
            A short write-up of the last {rangeLabel}: what {bot.name} worked on, what came out of it, and how that tracks its goal, with links to the notes and
            episodes behind each point. Written by {bot.name}&apos;s own model when you ask{bot.slug === "onion-reader" ? ", on this Mac only" : ""}.
          </p>
          {button}
        </div>
      ) : (
        <div className={`space-y-4 transition-opacity ${writing ? "opacity-60" : ""}`}>
          <p className="max-w-4xl text-[15px] leading-relaxed text-ink">{digest.recap || "The model wrote nothing useful this time. Try Rewrite."}</p>

          {digest.highlights.length ? (
            <ul className="space-y-1.5">
              {digest.highlights.map((h, i) => (
                <li key={i} className="flex gap-2 text-sm text-ink/90">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-muted" aria-hidden />
                  <span>
                    {h.text}
                    <RefChips refs={h.refs} nodes={nodes} onOpen={onOpen} />
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          {digest.goals.length ? (
            <div>
              <h3 className="mb-2 text-xs font-semibold text-muted">
                {digest.goalSource === "goals" ? "Goal progress" : digest.goalSource === "expected output" ? "Progress on its expected output" : "Progress (no goal written; judged against its bio)"}
              </h3>
              <ul className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3">
                {digest.goals.map((g, i) => {
                  const v = VERDICT_STYLE[g.verdict];
                  return (
                    <li key={i} className="rounded-xl bg-grouped-3 p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <span className="font-semibold text-ink">{g.goal}</span>
                        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-2xs font-semibold ${v.className}`}>
                          <Icon name={v.icon} className="h-3 w-3" />
                          {v.label}
                        </span>
                      </div>
                      {g.evidence ? <p className="mt-1 text-muted">{g.evidence}</p> : null}
                      <div className="mt-1.5">
                        <RefChips refs={g.refs} nodes={nodes} onOpen={onOpen} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}

          {digest.next ? (
            <p className="text-sm">
              <span className="font-semibold text-ink">Next: </span>
              <span className="text-ink/85">{digest.next}</span>
            </p>
          ) : null}

          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <span>
              Written {ago(digest.generatedAt, clock)} by {digest.model || "the bot's model"}
              {digest.localOnly ? " (local only: nothing it read leaves this Mac)" : ""}
            </span>
            {stale ? <span className="font-semibold text-warn">· may be out of date</span> : null}
            <CopyButton
              text={() =>
                [
                  `${bot.name}, last ${rangeLabel}`,
                  digest.recap,
                  ...digest.highlights.map((h) => `- ${h.text}`),
                  ...digest.goals.map((g) => `Goal: ${g.goal} (${g.verdict}). ${g.evidence}`),
                  digest.next ? `Next: ${digest.next}` : "",
                ]
                  .filter(Boolean)
                  .join("\n")
              }
              what="recap"
            />
          </p>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-3 rounded-lg bg-sys-red/10 px-3 py-2 text-sm text-bad">
          {error}
        </p>
      ) : null}
      {writing ? <p className="mt-3 text-xs text-muted">Writing with {bot.name}&apos;s model. This can take a minute when it falls back to the local model.</p> : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------------------------------------

export default function SummaryView({ bot, initialScope = "bot", initialRange = "24h" }: { bot: BotProfile; initialScope?: Scope; initialRange?: RangeKey }) {
  const [scope, setScope] = useState<Scope>(initialScope);
  const [range, setRange] = useState<RangeKey>(initialRange);
  const [data, setData] = useState<SummaryData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<TrailNode | null>(null);
  const [episodeText, setEpisodeText] = useState<string | null>(null);
  const rangeMeta = RANGE_KEYS.find((r) => r.key === range)!;

  // Keep the choice in the address (for a reload or a shared link) and in a cookie, so switching bots
  // or coming back later opens on the same period rather than resetting to 24 hours.
  useEffect(() => {
    for (const [name, value] of [[RANGE_COOKIE, range], [SCOPE_COOKIE, scope]] as const) {
      document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
    }
    const url = new URL(window.location.href);
    if (scope === "fleet") url.searchParams.set("scope", "fleet");
    else url.searchParams.delete("scope");
    if (range === "24h") url.searchParams.delete("range");
    else url.searchParams.set("range", range);
    window.history.replaceState(window.history.state, "", url);
  }, [scope, range]);

  const seq = useRef(0);
  const load = useCallback(async () => {
    if (scope !== "bot") return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/bots/${bot.slug}/summary?range=${range}`, { cache: "no-store" });
      const body = await res.json();
      if (mine !== seq.current) return; // a newer range was picked meanwhile
      if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
      else {
        setData(body as SummaryData);
        setError(null);
      }
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err instanceof Error ? err.message : "request failed");
    }
    setLoading(false);
  }, [bot.slug, range, scope]);
  const refresh = useCallback(() => void load(), [load]);
  useVisibleInterval(refresh, 60000);
  const firstRange = useRef(true);
  useEffect(() => {
    if (firstRange.current) {
      firstRange.current = false; // the interval hook does the first load
      return;
    }
    refresh();
  }, [refresh]);

  // Episode details for the sheet (the full text, as the dashboard's copy button gives it).
  useEffect(() => {
    if (!open || open.kind !== "episode") return;
    let live = true;
    fetch(`/api/bots/${bot.slug}/episodes?id=${open.id.slice(1)}`, { cache: "no-store" })
      .then(async (r) => {
        const list = (await r.json()) as unknown;
        // An error shape or an empty list would leave the sheet on "Loading…" for ever: say it failed instead.
        const text = r.ok && Array.isArray(list) ? (list as Episode[])[0]?.text : undefined;
        if (live) setEpisodeText(text ?? "(This episode could not be loaded.)");
      })
      .catch(() => live && setEpisodeText("(This episode could not be loaded.)"));
    return () => {
      live = false;
      setEpisodeText(null);
    };
  }, [open, bot.slug]);

  const groupTotals = data ? GROUP_ORDER.map((g) => ({ g, v: data.buckets.reduce((a, b) => a + b.counts[g], 0) })) : [];
  const busiest = data ? data.buckets.reduce((best, b) => (GROUP_ORDER.reduce((a, g) => a + b.counts[g], 0) > GROUP_ORDER.reduce((a, g) => a + best.counts[g], 0) ? b : best), data.buckets[0]) : null;

  return (
    <AppChrome title="Summary" subtitle={scope === "fleet" ? "What every bot did, and how work moved between them" : `What ${bot.name} did, and how it got there`}>
      {/* Filters: one row above everything they scope. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div className="w-full sm:w-auto">
          <Segmented<Scope>
            label="Show"
            value={scope}
            onChange={setScope}
            options={[
              { key: "bot", label: bot.name },
              { key: "fleet", label: "All bots" },
            ]}
          />
        </div>
        <div className="w-full sm:w-auto">
          <Segmented<RangeKey> label="Period" value={range} onChange={setRange} options={RANGE_KEYS} />
        </div>
        {scope === "bot" && loading ? <Spinner /> : null}
      </div>

      {scope === "fleet" ? (
        <FleetView range={range} />
      ) : (
        <>
          {error ? <p className="mb-5 rounded-xl bg-sys-red/10 p-4 text-sm text-bad">Could not load the summary: {error}</p> : null}

          {data ? (
            <div className={`space-y-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
              <RecapPanel key={range} bot={bot} range={range} nodes={data.trail.nodes} onOpen={setOpen} />

              <StatTiles totals={data.totals} previous={data.previous} rangeLong={rangeMeta.long} />

              <Panel
                title="Activity"
                aside={busiest && GROUP_ORDER.some((g) => busiest.counts[g]) ? `busiest: ${busiest.label}` : undefined}
                hint={`${compact(data.totals.actions)} actions in the last ${rangeMeta.label}, ${compact(data.totals.refused)} of them refused by its safety rules.`}
              >
                <ActivityChart buckets={data.buckets} />
              </Panel>
              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                <Panel title="What it did">
                  <Bars rows={groupTotals.map(({ g, v }) => ({ key: g, label: GROUP_META[g].label, value: v, color: GROUP_META[g].color }))} />
                  <p className="mt-3 text-xs text-muted">
                    Most: {data.byAction.slice(0, 4).map((a) => `${a.action} ${a.count}`).join(" · ") || "nothing yet"}
                  </p>
                </Panel>
                <Panel title="Where it read">
                  {data.domains.length ? <Bars rows={data.domains.map((d) => ({ key: d.domain, label: friendlyDomain(d.domain), value: d.pages }))} /> : <p className="text-sm text-muted">No pages read.</p>}
                </Panel>
              </div>

              <Panel
                title="Trail"
                aside={`${data.trail.nodes.filter((n) => n.kind === "episode").length} most recent episodes`}
                hint="Follow the work from the question it chased, through each episode, to the notes it saved and the tasks it created. Point at anything to light up its path; green lines are notes that answered a question. Click for details and links."
              >
                <Trail data={data.trail} onOpen={setOpen} />
              </Panel>
            </div>
          ) : !error ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner /> Reading {bot.name}&apos;s history…
            </p>
          ) : null}
        </>
      )}

      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open ? { question: "Question", episode: open.label, note: "Note", task: "Task" }[open.kind] : ""}>
        {open ? (
          <div className="space-y-3 text-sm">
            {open.kind !== "episode" ? <p className="font-semibold text-ink">{open.label}</p> : null}
            {open.kind === "question" ? <p className={open.status === "answered" ? "text-good" : "text-muted"}>{open.detail}</p> : null}
            {open.kind === "note" || open.kind === "episode" ? <p className="max-h-72 overflow-y-auto whitespace-pre-line text-ink/85">{open.detail || "No summary yet."}</p> : null}
            {open.kind === "task" && open.detail ? <p className="text-muted">{open.detail}</p> : null}
            <p className="text-xs text-muted">{new Date(open.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</p>
            <div className="flex flex-wrap gap-2 pt-1">
              {open.href ? (
                <a href={open.href} target="_blank" rel="noreferrer" className={buttonClass("tinted", "sm")}>
                  <Icon name="link" className="h-3.5 w-3.5" />
                  {open.kind === "task" ? "Open in Notion" : "Open source"}
                </a>
              ) : null}
              {open.kind === "episode" ? (
                episodeText ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-fill-3 py-1 pr-1.5 pl-3 text-xs font-semibold text-ink">
                    Copy full episode <CopyButton text={episodeText} what={open.label.toLowerCase()} />
                  </span>
                ) : (
                  <span className="flex items-center gap-2 text-xs text-muted">
                    <Spinner small /> Loading the full episode…
                  </span>
                )
              ) : null}
            </div>
          </div>
        ) : null}
      </Sheet>
    </AppChrome>
  );
}

