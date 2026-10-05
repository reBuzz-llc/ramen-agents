"use client";

// Pieces shared by the Summary tab's bot and fleet views.
import type { RangeKey, Totals } from "@/lib/summary";

export const RANGE_KEYS: { key: RangeKey; label: string; long: string }[] = [
  { key: "24h", label: "24 hours", long: "previous 24 hours" },
  { key: "7d", label: "7 days", long: "previous 7 days" },
  { key: "30d", label: "30 days", long: "previous 30 days" },
  { key: "90d", label: "90 days", long: "previous 90 days" },
];

export const compact = (n: number) => (n >= 10000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}K` : n.toLocaleString());

export function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 3, 4, 5, 6, 8, 10]) if (m * pow >= v) return m * pow;
  return 10 * pow;
}

// ---------------------------------------------------------------------------------------------------------
// Stat tiles

export const TILES: { key: keyof Totals; label: string; upIsGood: boolean }[] = [
  { key: "episodes", label: "Episodes", upIsGood: true },
  { key: "notes", label: "Notes", upIsGood: true },
  { key: "answered", label: "Questions answered", upIsGood: true },
  { key: "tasks", label: "Tasks created", upIsGood: true },
  { key: "pages", label: "Pages read", upIsGood: true },
  { key: "refused", label: "Refused actions", upIsGood: false },
];

export function StatTiles({ totals, previous, rangeLong, tiles = TILES }: { totals: Totals; previous: Totals; rangeLong: string; tiles?: typeof TILES }) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-3 xl:grid-cols-6">
      {tiles.map((t) => {
        const now = totals[t.key];
        const before = previous[t.key];
        const diff = now - before;
        const good = diff === 0 ? null : diff > 0 === t.upIsGood;
        return (
          <div key={t.key} className="min-w-0 rounded-xl bg-panel px-3.5 py-3">
            <div className="truncate text-xs font-semibold text-muted">{t.label}</div>
            <div className="mt-0.5 font-rounded text-2xl font-bold text-ink">{compact(now)}</div>
            <div className="mt-0.5 truncate text-xs text-muted">
              {before === 0 && now > 0 ? (
                <>new this period</>
              ) : diff === 0 ? (
                <>same as {rangeLong}</>
              ) : (
                <>
                  <span className={good ? "font-semibold text-good" : "font-semibold text-bad"}>
                    {diff > 0 ? "▲" : "▼"} {compact(Math.abs(diff))}
                  </span>{" "}
                  vs {rangeLong}
                </>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------
// Horizontal bars (single series: no legend)

export function Bars({ rows, color = "var(--viz-1)" }: { rows: { label: string; value: number; key?: string; color?: string }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key ?? r.label} className="text-sm" title={`${r.label}: ${r.value}`}>
          <div className="mb-0.5 flex justify-between gap-3">
            <span className="truncate text-ink">{r.label}</span>
            <span className="shrink-0 text-muted tabular-nums">{r.value.toLocaleString()}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-fill-3">
            <div className="h-full rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color ?? color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** An iOS segmented control (radio group). */
export function Segmented<T extends string>({ label, options, value, onChange }: { label: string; options: { key: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex gap-1 rounded-full bg-fill-3 p-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          role="radio"
          aria-checked={o.key === value}
          onClick={() => onChange(o.key)}
          className={`pressable h-8 min-w-0 flex-1 truncate rounded-full sm:flex-none sm:overflow-visible px-3 text-xs font-semibold whitespace-nowrap transition-colors sm:px-4 ${o.key === value ? "bg-[var(--seg-thumb)] text-ink shadow-[0_1px_3px_rgb(0_0_0/0.14)]" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
