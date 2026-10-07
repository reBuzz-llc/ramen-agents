"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FleetData, MapEdge, MapNode } from "@/lib/fleet";
import { Icon } from "./ui";

// The relation map: you in the middle, the bots on a ring around you, and the places their output goes
// (Notion, the Scout's provider finds) outside the ring next to the bot that sends there. Edges are
// quadratic curves trimmed to each node's outline, so arrowheads land on the pill instead of under it.

export const EDGE_GROUPS = {
  bots: { label: "Bot to bot", color: "var(--viz-1)" },
  you: { label: "With you", color: "var(--viz-2)" },
  outputs: { label: "Outputs", color: "var(--viz-3)" },
} as const;
export type EdgeGroup = keyof typeof EDGE_GROUPS;

export function edgeGroup(e: Pick<MapEdge, "kind"> | undefined): EdgeGroup {
  if (!e) return "bots";
  return e.kind === "handoff" || e.kind === "message" || e.kind === "room" ? "bots" : e.kind === "chat" || e.kind === "say" ? "you" : "outputs";
}

type P = { x: number; y: number };
const NODE_H = 40;

function nodeHalfWidth(n: MapNode, narrow: boolean): number {
  if (n.kind === "owner") return 34;
  if (n.kind === "bot" && narrow) return 34; // a phone shows just the handle: short, and enough to tell them apart
  const chars = Math.min(n.label.length, narrow ? 12 : 20);
  const tag = n.kind === "bot" ? 17 : 0; // room for the handle beside the name
  return Math.min(narrow ? 62 : 112, 26 + chars * 3.6 + tag);
}

/** Distance from an ellipse's center to its outline in direction (ux, uy). */
function toEdge(ux: number, uy: number, a: number, b: number): number {
  return 1 / Math.sqrt((ux / a) ** 2 + (uy / b) ** 2 || 1);
}

export default function FleetMap({ data, onEdge, onNode }: { data: FleetData; onEdge: (e: MapEdge) => void; onNode: (id: string) => void }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(900);
  const [hover, setHover] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setW(Math.max(300, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = W < 600;
  const { pos, H } = useMemo(() => {
    const bots = data.map.nodes.filter((n) => n.kind === "bot");
    const sinks = data.map.nodes.filter((n) => n.kind === "notion" || n.kind === "providers" || n.kind === "room");
    const botEdges = data.map.edges.filter((e) => edgeGroup(e) === "bots");
    // Order the ring so bots that work together sit side by side.
    const degree = (id: string, among: Set<string>) => botEdges.filter((e) => (e.from === id && among.has(e.to)) || (e.to === id && among.has(e.from))).length;
    const all = new Set(bots.map((b) => b.id));
    const order: MapNode[] = [];
    const left = [...bots].sort((a, b) => degree(b.id, all) - degree(a.id, all) || a.label.localeCompare(b.label));
    while (left.length) {
      const placed = new Set(order.map((o) => o.id));
      left.sort((a, b) => degree(b.id, placed) - degree(a.id, placed) || degree(b.id, all) - degree(a.id, all));
      order.push(left.shift()!);
    }

    const rx = narrow ? W / 2 - 62 : Math.min(W * 0.3, 330);
    const ry = narrow ? 230 : 150;
    const sinkGap = sinks.length ? (narrow ? 80 : 90) : 0;
    const height = narrow ? 2 * ry + 96 + sinkGap : 2 * (ry + sinkGap) + 90;
    const cx = W / 2;
    const cy = narrow ? ry + 48 : height / 2;
    const out = new Map<string, P>();
    out.set("owner", { x: cx, y: cy });
    const angle = new Map<string, number>();
    order.forEach((n, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(1, order.length);
      angle.set(n.id, a);
      out.set(n.id, { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) });
    });
    sinks.forEach((s, i) => {
      if (narrow) {
        out.set(s.id, { x: (W * (i + 1)) / (sinks.length + 1), y: height - 30 });
        return;
      }
      if (s.kind === "room") {
        // Everyone posts here, so it sits in the gap between two bots closest to the left side, not beside one bot.
        const step = (2 * Math.PI) / Math.max(1, order.length);
        const k = Math.round((Math.PI + Math.PI / 2 - step / 2) / step);
        const a = -Math.PI / 2 + step * k + step / 2;
        out.set(s.id, { x: Math.min(W - 70, Math.max(70, cx + (rx + 150) * Math.cos(a))), y: Math.min(height - 26, Math.max(26, cy + (ry + sinkGap) * Math.sin(a))) });
        return;
      }
      const sources = data.map.edges.filter((e) => e.to === s.id).map((e) => angle.get(e.from)).filter((a): a is number => a !== undefined);
      const a = sources.length ? Math.atan2(sources.reduce((t, x) => t + Math.sin(x), 0), sources.reduce((t, x) => t + Math.cos(x), 0)) : 0;
      out.set(s.id, { x: Math.min(W - 70, Math.max(70, cx + (rx + 150) * Math.cos(a))), y: Math.min(height - 26, Math.max(26, cy + (ry + sinkGap) * Math.sin(a))) });
    });
    // Fit the box to what was placed, so there is no empty band above or below the drawing.
    const ys = [...out.values()].map((p) => p.y);
    const top = Math.min(...ys) - NODE_H / 2 - 12;
    const bottom = Math.max(...ys) + NODE_H / 2 + 12;
    for (const p of out.values()) p.y -= top;
    return { pos: out, H: Math.max(height * 0.5, bottom - top) };
  }, [data.map, W, narrow]);

  const nodeById = useMemo(() => new Map(data.map.nodes.map((n) => [n.id, n])), [data.map.nodes]);
  const maxCount = Math.max(1, ...data.map.edges.map((e) => e.count));

  const paths = data.map.edges.flatMap((e) => {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    const na = nodeById.get(e.from);
    const nb = nodeById.get(e.to);
    if (!a || !b || !na || !nb) return [];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const reverse = data.map.edges.some((o) => o.from === e.to && o.to === e.from);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    let bend = reverse ? 18 : 0;
    if (!reverse && edgeGroup(e) === "bots") {
      // Bow bot-to-bot chords away from the middle, so they do not run through you.
      const c = pos.get("owner")!;
      const away = (mid.x - c.x) * nx + (mid.y - c.y) * ny >= 0 ? 1 : -1;
      bend = away * Math.min(60, len * 0.18);
    }
    const c = { x: mid.x + nx * bend, y: mid.y + ny * bend };
    const trim = (p: P, n: MapNode, gap: number) => {
      const vx = c.x - p.x;
      const vy = c.y - p.y;
      const l = Math.hypot(vx, vy) || 1;
      const d = toEdge(vx / l, vy / l, nodeHalfWidth(n, narrow) + 2, NODE_H / 2 + 2) + gap;
      return { x: p.x + (vx / l) * d, y: p.y + (vy / l) * d };
    };
    const s = trim(a, na, 2);
    const t = trim(b, nb, 6);
    // Labels sit nearer the sender, so the two counts of a two-way pair never land on the same spot.
    const k = reverse ? 0.36 : 0.5;
    const label = { x: (1 - k) ** 2 * s.x + 2 * k * (1 - k) * c.x + k ** 2 * t.x, y: (1 - k) ** 2 * s.y + 2 * k * (1 - k) * c.y + k ** 2 * t.y };
    return [{ e, d: `M${s.x},${s.y} Q${c.x},${c.y} ${t.x},${t.y}`, label }];
  });

  const lit = (e: MapEdge) => !hover || e.from === hover || e.to === hover;
  const near = (id: string) => !hover || id === hover || data.map.edges.some((e) => (e.from === hover && e.to === id) || (e.to === hover && e.from === id));

  return (
    <div>
      <ul className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label="Legend">
        {(Object.keys(EDGE_GROUPS) as EdgeGroup[]).map((g) => (
          <li key={g} className="flex items-center gap-1.5">
            <span className="h-0.5 w-4 rounded-full" style={{ background: EDGE_GROUPS[g].color }} />
            {EDGE_GROUPS[g].label}
          </li>
        ))}
        <li className="flex items-center gap-1.5">
          <svg width="16" height="2" aria-hidden>
            <line x1="0" x2="16" y1="1" y2="1" stroke="var(--muted)" strokeDasharray="3 3" strokeWidth="1.5" />
          </svg>
          Set up, nothing moved
        </li>
      </ul>
      <div ref={wrap} className="relative w-full" style={{ height: H }} onPointerLeave={() => setHover(null)}>
        <svg width={W} height={H} className="absolute inset-0 overflow-visible" role="img" aria-label="Relation map of the bots">
          <defs>
            {(Object.keys(EDGE_GROUPS) as EdgeGroup[]).map((g) => (
              <marker key={g} id={`arrow-${g}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
                <path d="M1,1 L9,5 L1,9" fill="none" stroke={EDGE_GROUPS[g].color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            ))}
            <marker id="arrow-quiet" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" markerUnits="userSpaceOnUse" orient="auto-start-reverse">
              <path d="M1,1 L9,5 L1,9" fill="none" stroke="var(--muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
            </marker>
          </defs>
          {paths.map(({ e, d }) => {
            const g = edgeGroup(e);
            const quiet = e.count === 0;
            return (
              <g key={e.id} opacity={lit(e) ? 1 : 0.12} className="transition-opacity">
                <path
                  d={d}
                  fill="none"
                  stroke={quiet ? "var(--muted)" : EDGE_GROUPS[g].color}
                  strokeOpacity={quiet ? 0.55 : 0.9}
                  strokeWidth={quiet ? 1.25 : 1.5 + 2.5 * Math.sqrt(e.count / maxCount)}
                  strokeDasharray={quiet ? "4 4" : undefined}
                  strokeLinecap="round"
                  markerEnd={`url(#arrow-${quiet ? "quiet" : g})`}
                />
                <path d={d} fill="none" stroke="transparent" strokeWidth={14} className="cursor-pointer" onClick={() => onEdge(e)} onPointerEnter={() => setHover(null)}>
                  <title>
                    {nodeById.get(e.from)?.label} → {nodeById.get(e.to)?.label}: {e.count} {e.label}
                    {e.refused ? `, ${e.refused} refused` : ""}
                  </title>
                </path>
              </g>
            );
          })}
        </svg>

        {paths
          .filter(({ e }) => e.count > 0 || e.refused > 0)
          .map(({ e, label }) => (
            <button
              key={`l-${e.id}`}
              type="button"
              onClick={() => onEdge(e)}
              style={{ left: label.x, top: label.y, opacity: lit(e) ? 1 : 0.15 }}
              className="pressable absolute z-10 flex h-5 min-w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-panel px-1.5 text-2xs font-semibold text-ink tabular-nums shadow-[0_0_0_1px_var(--line)] transition-opacity hover:bg-fill-3"
              aria-label={`${nodeById.get(e.from)?.label} to ${nodeById.get(e.to)?.label}: ${e.count} ${e.label}${e.refused ? `, ${e.refused} refused` : ""}`}
            >
              {e.count}
              {e.refused ? <span className="ml-0.5 font-normal text-muted">+{e.refused}✕</span> : null}
            </button>
          ))}

        {data.map.nodes.map((n) => {
          const p = pos.get(n.id);
          if (!p) return null;
          const hw = nodeHalfWidth(n, narrow);
          const icon = n.kind === "owner" ? "person" : n.kind === "room" ? "chat" : n.kind === "notion" ? "note" : n.kind === "providers" ? "key" : null;
          return (
            <button
              key={n.id}
              type="button"
              onClick={() => onNode(n.id)}
              onPointerEnter={() => setHover(n.id)}
              onFocus={() => setHover(n.id)}
              onBlur={() => setHover(null)}
              style={{ left: p.x - hw, top: p.y - NODE_H / 2, width: hw * 2, height: NODE_H, opacity: near(n.id) ? 1 : 0.4 }}
              className={`pressable absolute z-20 flex items-center justify-center gap-1.5 rounded-full px-2.5 text-xs font-semibold transition-opacity ${
                n.kind === "owner"
                  ? "bg-sys-blue text-white shadow-[0_2px_8px_rgb(0_0_0/0.18)]"
                  : n.kind === "bot"
                    ? "bg-panel text-ink shadow-[0_0_0_1px_var(--line),0_2px_8px_rgb(0_0_0/0.08)] hover:bg-fill-3"
                    : "bg-grouped-3 text-ink shadow-[0_0_0_1px_var(--line)] hover:bg-fill-3"
              }`}
              title={n.label}
            >
              {icon ? <Icon name={icon} className="h-3.5 w-3.5 shrink-0" /> : <span className={`h-2 w-2 shrink-0 rounded-full ${n.held ? "bg-sys-orange" : n.running ? "bg-sys-green" : "bg-muted"}`} aria-label={n.held ? "held by The CEO" : n.running ? "running" : "not running"} />}
              {n.kind === "bot" ? (
                narrow ? (
                  <span className="font-mono tracking-tight">{n.handle}</span>
                ) : (
                  <>
                    <span className="truncate">{n.label}</span>
                    <span className="shrink-0 font-mono text-[10px] opacity-60">{n.handle}</span>
                  </>
                )
              ) : (
                <span className="truncate">{n.label}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
