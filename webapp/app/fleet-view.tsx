"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Exchange, FleetData, MapEdge } from "@/lib/fleet";
import type { RangeKey } from "@/lib/summary";
import { ago } from "@/lib/format";
import FleetMap, { EDGE_GROUPS, edgeGroup } from "./fleet-map";
import HandleTag from "./handle-tag";
import { useVisibleInterval } from "./hooks";
import Sheet from "./sheet";
import { compact, niceMax, RANGE_KEYS, Segmented, StatTiles, TILES } from "./summary-parts";
import { buttonClass, Icon, Panel, Spinner } from "./ui";

const EXCHANGE_CAP = 12;
type ExchangeFilter = "all" | "bots" | "you" | "outputs";

function Spark({ values, label }: { values: number[]; label: string }) {
  const max = niceMax(Math.max(1, ...values));
  const w = 120;
  const h = 28;
  const slot = w / values.length;
  const bar = Math.max(1.5, Math.min(6, slot - 2));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="block shrink-0" role="img" aria-label={label}>
      <line x1={0} x2={w} y1={h - 0.5} y2={h - 0.5} stroke="var(--viz-grid)" />
      {values.map((v, i) => {
        const bh = v ? Math.max(2, (v / max) * (h - 2)) : 0;
        return <rect key={i} x={i * slot + (slot - bar) / 2} y={h - bh} width={bar} height={bh} rx={Math.min(1.5, bar / 2)} fill="var(--viz-1)" />;
      })}
    </svg>
  );
}

// The loop's state, not its data server's: a stopped bot's data server keeps answering, and its last heartbeat says
// "exiting" for days, so "online" and "Stopping" both read wrong (owner, 2026-10-03: "why is stopped family showing
// online here?").
function statusOf(b: FleetData["bots"][number]): { label: string; dot: string } {
  if (b.stopped) return { label: "Stopped", dot: "bg-muted" };
  if (b.hold) {
    const until = new Date(b.hold.until).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return { label: `${b.hold.mode === "pause" ? "Paused" : "Slowed"} by ${b.hold.by} until ${until}`, dot: "bg-sys-orange" };
  }
  if (!b.running) return b.status === "paused" ? { label: "Paused", dot: "bg-sys-orange" } : { label: b.online ? "Not running" : "Offline", dot: "bg-muted" };
  if (b.status === "quiet" || b.status === "paused") return { label: b.status === "quiet" ? "Quiet" : "Paused", dot: "bg-sys-orange" };
  if (b.status === "exiting") return { label: "Stopping", dot: "bg-sys-orange" };
  return { label: "Running", dot: "bg-sys-green" };
}

function ExchangeList({ items }: { items: Exchange[] }) {
  const [more, setMore] = useState(false);
  if (!items.length) return <p className="text-sm text-muted">Nothing moved here in this period.</p>;
  const shown = more ? items : items.slice(0, EXCHANGE_CAP);
  return (
    <>
      <ol className="divide-y divide-line">
        {shown.map((x, i) => (
          <li key={`${x.at}-${i}`} className="group flex items-start gap-3 py-2.5">
            <span className="mt-0.5 w-12 shrink-0 text-xs text-muted tabular-nums">{new Date(x.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hourCycle: "h23" })}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="text-sm font-semibold text-ink">{x.title}</span>
                <span className="text-xs text-muted">
                  {x.from} → {x.to} · {new Date(x.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                </span>
                {x.refused ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-sys-red/10 px-2 py-0.5 text-2xs font-semibold text-bad">
                    <Icon name="stop" className="h-2.5 w-2.5" /> Refused
                  </span>
                ) : null}
              </div>
              {x.text ? <p className="mt-0.5 line-clamp-2 text-sm text-ink/80">{x.text}</p> : null}
              {x.refused ? <p className="mt-0.5 text-xs text-muted">Why: {x.refused}</p> : null}
            </div>
            {x.href ? (
              <Link href={x.href} className="hit shrink-0 rounded-full p-1.5 text-muted hover:bg-fill-3 hover:text-ink" aria-label={`Open ${x.from}`}>
                <Icon name="chevron-right" className="h-4 w-4" />
              </Link>
            ) : null}
          </li>
        ))}
      </ol>
      {items.length > EXCHANGE_CAP ? (
        <button type="button" onClick={() => setMore((v) => !v)} className={buttonClass("plain", "sm")}>
          {more ? "Show less" : `Show ${items.length - EXCHANGE_CAP} more`}
        </button>
      ) : null}
    </>
  );
}

export default function FleetView({ range }: { range: RangeKey }) {
  const [data, setData] = useState<FleetData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ExchangeFilter>("all");
  const [refused, setRefused] = useState(false);
  const [focus, setFocus] = useState<{ title: string; edges: string[] } | null>(null);
  const [now, setNow] = useState(0);
  const rangeMeta = RANGE_KEYS.find((r) => r.key === range)!;

  const seq = useRef(0);
  const load = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    try {
      const res = await fetch(`/api/fleet/summary?range=${range}`, { cache: "no-store" });
      const body = await res.json();
      if (mine !== seq.current) return;
      if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
      else {
        setData(body as FleetData);
        setError(null);
        setNow(Date.now());
      }
    } catch (err) {
      if (mine !== seq.current) return;
      setError(err instanceof Error ? err.message : "request failed");
    }
    setLoading(false);
  }, [range]);
  const refresh = useCallback(() => void load(), [load]);
  useVisibleInterval(refresh, 60000);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    refresh();
  }, [refresh]);

  if (!data) {
    return error ? (
      <p className="rounded-xl bg-sys-red/10 p-4 text-sm text-bad">Could not load the fleet: {error}</p>
    ) : (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Reading every bot&apos;s history…
      </p>
    );
  }

  const edgeById = new Map(data.map.edges.map((e) => [e.id, e]));
  const listed = data.exchanges.filter((x) => {
    if (!refused && x.refused) return false;
    const g = edgeGroup(edgeById.get(x.edge) as MapEdge);
    return filter === "all" || g === filter;
  });
  const focused = focus ? data.exchanges.filter((x) => focus.edges.includes(x.edge)) : [];
  const moved = data.map.edges.reduce((a, e) => a + (edgeGroup(e) === "bots" ? e.count : 0), 0);

  return (
    <div className={`space-y-5 transition-opacity ${loading ? "opacity-60" : ""}`}>
      {error ? <p className="rounded-xl bg-sys-red/10 p-3 text-sm text-bad">Could not refresh: {error}</p> : null}
      <StatTiles totals={data.totals} previous={data.previous} rangeLong={rangeMeta.long} tiles={TILES} />

      <Panel
        title="Relation map"
        aside={`${moved} hand-off${moved === 1 ? "" : "s"} between bots`}
        hint="Who works with whom. Thicker lines carried more; dashed lines are set up but carried nothing this period. Point at a bot to light up its channels; click a count or a bot to see what moved."
      >
        <FleetMap
          data={data}
          onEdge={(e) => {
            const a = data.map.nodes.find((n) => n.id === e.from)?.label ?? e.from;
            const b = data.map.nodes.find((n) => n.id === e.to)?.label ?? e.to;
            setFocus({ title: `${a} → ${b}`, edges: [e.id] });
          }}
          onNode={(id) => {
            const node = data.map.nodes.find((n) => n.id === id);
            setFocus({ title: node?.label ?? id, edges: data.map.edges.filter((e) => e.from === id || e.to === id).map((e) => e.id) });
          }}
        />
      </Panel>

      <Panel title="Bots" aside={`last ${rangeMeta.label}`}>
        <ul className="divide-y divide-line">
          {data.bots.map((b) => {
            const s = statusOf(b);
            const out = [
              b.totals.tasks ? `${b.totals.tasks} task${b.totals.tasks === 1 ? "" : "s"}` : "",
              b.outputs.packages ? `${b.outputs.packages} package${b.outputs.packages === 1 ? "" : "s"}` : "",
              b.outputs.providers ? `${b.outputs.providers} provider${b.outputs.providers === 1 ? "" : "s"}` : "",
              b.outputs.messages ? `${b.outputs.messages} message${b.outputs.messages === 1 ? "" : "s"}` : "",
            ].filter(Boolean);
            const refusedPct = b.totals.actions ? Math.round((b.totals.refused / b.totals.actions) * 100) : 0;
            return (
              <li key={b.slug}>
                <Link href={`/bots/${b.slug}/summary?scope=bot${range === "24h" ? "" : `&range=${range}`}`} className="pressable -mx-2 flex flex-col gap-2 rounded-lg px-2 py-3 hover:bg-fill-3 lg:flex-row lg:items-center lg:gap-5">
                  <div className="flex min-w-0 items-center gap-3 lg:w-56 lg:shrink-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate text-sm font-semibold text-ink">{b.name}</span>
                        <HandleTag handle={b.handle} name={b.name} />
                      </div>
                      <div className="flex items-center gap-1.5 text-xs text-muted">
                        <span className={`h-2 w-2 rounded-full ${s.dot}`} aria-hidden />
                        {s.label} · active {ago(b.lastActive, now)}
                      </div>
                    </div>
                    <span className="lg:hidden">
                      <Spark values={b.spark} label={`${b.name}: actions over the period`} />
                    </span>
                  </div>
                  <span className="hidden lg:block">
                    <Spark values={b.spark} label={`${b.name}: actions over the period`} />
                  </span>
                  <dl className="grid grid-cols-4 gap-2 text-xs lg:w-80 lg:shrink-0">
                    {[
                      ["Episodes", b.totals.episodes],
                      ["Notes", b.totals.notes],
                      ["Answered", b.totals.answered],
                      ["Refused", `${refusedPct}%`],
                    ].map(([k, v]) => (
                      <div key={k as string}>
                        <dt className="text-muted">{k}</dt>
                        <dd className="font-rounded text-sm font-semibold text-ink tabular-nums">{typeof v === "number" ? compact(v) : v}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="min-w-0 flex-1 text-sm">
                    {b.error ? (
                      <p className="text-bad">Could not read its database: {b.error}</p>
                    ) : b.recap ? (
                      <p className="line-clamp-2 text-ink/85">{b.recap.text}</p>
                    ) : (
                      <p className="text-muted">{out.length ? `Produced ${out.join(", ")}.` : "No recap written for this period yet."}</p>
                    )}
                    {b.recap && out.length ? <p className="mt-0.5 text-xs text-muted">Produced {out.join(", ")}</p> : null}
                  </div>
                  <Icon name="chevron-right" className="hidden h-4 w-4 shrink-0 text-muted lg:block" />
                </Link>
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title="What moved" aside={`${listed.length} in this period`}>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="w-full sm:w-auto">
            <Segmented<ExchangeFilter>
              label="Which channels"
              value={filter}
              onChange={setFilter}
              options={[
                { key: "all", label: "All" },
                { key: "bots", label: EDGE_GROUPS.bots.label },
                { key: "you", label: EDGE_GROUPS.you.label },
                { key: "outputs", label: EDGE_GROUPS.outputs.label },
              ]}
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" checked={refused} onChange={(e) => setRefused(e.target.checked)} className="h-4 w-4 accent-[var(--accent)]" />
            Include refused
          </label>
        </div>
        <ExchangeList key={`${filter}-${refused}`} items={listed} />
      </Panel>

      <Sheet open={focus !== null} onClose={() => setFocus(null)} title={focus?.title ?? ""}>
        {focus ? (
          <div className="space-y-3">
            {focus.edges.length ? (
              <ul className="flex flex-wrap gap-1.5">
                {focus.edges.map((id) => {
                  const e = edgeById.get(id);
                  if (!e) return null; // the edge aged out of the window since the sheet opened
                  const a = data.map.nodes.find((n) => n.id === e.from)?.label;
                  const b = data.map.nodes.find((n) => n.id === e.to)?.label;
                  return (
                    <li key={id} className="rounded-full bg-fill-3 px-2.5 py-1 text-xs text-ink">
                      {a} → {b}: {e.count} {e.label}
                      {e.refused ? `, ${e.refused} refused` : ""}
                      {e.configured && !e.count ? " (set up, quiet)" : ""}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <p className="text-sm text-muted">No channels.</p>
            )}
            <div className="max-h-[55vh] overflow-y-auto">
              <ExchangeList items={focused} />
            </div>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
