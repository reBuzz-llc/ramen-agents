"use client";

import { useEffect, useState } from "react";
import type { Period, UsageReport } from "@/lib/usage-history";
import { Panel, Spinner } from "../../ui";
import { Segmented } from "../../summary-parts";
import SortableTable from "../../sortable-table";

const PERIODS: { key: Period; label: string }[] = [
  { key: "month", label: "Month" },
  { key: "3months", label: "3 months" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];
const SEARCH_NAMES: Record<string, string> = { tavily: "Tavily", langsearch: "LangSearch", parallel: "Parallel" };
const UNIT: Record<Period, string> = { month: "day", "3months": "week", quarter: "week", year: "month" };
const big = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString();
const day = (d: string) => new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });

/** Tokens per day, week or month: one series, so no legend; the hovered bar's figures sit above the chart. */
function TokenBars({ report }: { report: UsageReport }) {
  const [hover, setHover] = useState<number | null>(null);
  const b = report.buckets;
  const max = Math.max(1, ...b.map((x) => x.tokens));
  const every = b.length > 16 ? Math.ceil(b.length / 8) : 1;
  const shown = hover === null ? null : b[hover];
  return (
    <div>
      <p className="mb-2 h-5 text-sm text-ink/85 tabular-nums" aria-live="polite">
        {shown
          ? `${shown.from === shown.to ? day(shown.from) : `${day(shown.from)} – ${day(shown.to)}`}: ${shown.tokens.toLocaleString()} tokens, ${shown.calls.toLocaleString()} calls${
              shown.days ? "" : " (no record)"
            }`
          : `Tokens per ${UNIT[report.period]}; point at a bar for its figures. Highest: ${big(max === 1 ? 0 : max)}`}
      </p>
      <div
        role="img"
        aria-label={`Tokens per ${UNIT[report.period]}, ${report.label}`}
        className="flex h-40 items-end gap-[2px] border-b border-line"
        onMouseLeave={() => setHover(null)}
      >
        {b.map((x, i) => (
          <div
            key={x.key}
            className="flex h-full min-w-0 flex-1 cursor-default items-end"
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            tabIndex={0}
            aria-label={`${x.label}: ${x.tokens.toLocaleString()} tokens`}
          >
            <div
              className={`w-full rounded-t-[4px] ${x.days ? (hover === i ? "bg-accent" : "bg-accent/75") : "bg-fill"}`}
              style={{ height: x.days ? `${Math.max(2, (x.tokens / max) * 100)}%` : "2px" }}
            />
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-[2px] text-[11px] text-muted">
        {b.map((x, i) => (
          <span key={x.key} className="min-w-0 flex-1 truncate text-center">
            {i % every === 0 ? x.label : ""}
          </span>
        ))}
      </div>
    </div>
  );
}

function Share({ part, whole }: { part: number; whole: number }) {
  const pct = whole ? Math.round((part / whole) * 100) : 0;
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-fill">
        <span className="block h-full rounded-full bg-accent/75" style={{ width: `${pct}%` }} />
      </span>
      <span className="w-9 text-right text-xs text-muted tabular-nums">{pct}%</span>
    </span>
  );
}

/** Model calls, tokens, searches and email checks over a month, three months, a quarter or a year. */
export default function ReportsView() {
  const [period, setPeriod] = useState<Period>("month");
  // The answer is kept with the period it is for, so switching shows the spinner until the new one arrives.
  const [got, setGot] = useState<{ period: Period; report?: UsageReport; error?: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/usage-report?period=${period}`, { cache: "no-store" })
      .then(async (r) => (r.ok ? ((await r.json()) as UsageReport) : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((report) => live && setGot({ period, report }))
      .catch((e: unknown) => live && setGot({ period, error: e instanceof Error ? e.message : String(e) }));
    return () => {
      live = false;
    };
  }, [period]);
  const current = got?.period === period ? got : null;
  const data = current?.report ?? null;
  const error = current?.error ?? "";

  const searches = data ? Object.entries(data.totals.searches).filter(([, n]) => n > 0) : [];
  const searchTotal = searches.reduce((a, [, n]) => a + n, 0);
  return (
    <div className="space-y-5">
      <Segmented<Period> label="Period" value={period} onChange={setPeriod} options={PERIODS} />
      {error ? (
        <p className="rounded-xl bg-sys-red/10 p-4 text-sm text-bad">{error}</p>
      ) : !data ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Adding up the usage…
        </p>
      ) : (
        <>
          <p className="rounded-xl bg-sys-blue/10 px-4 py-3 text-sm text-ink">
            {data.label}: {day(data.from)} to {day(data.to)}. Usage has been recorded every day since{" "}
            {data.since ? day(data.since) : "today"}, so {data.daysRecorded} of the period&apos;s {data.daysInPeriod} days have
            figures{data.daysRecorded < data.daysInPeriod ? "; the earlier days were never kept by the bots" : ""}. Email checks
            reach further back.
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: "Model calls", value: data.totals.calls.toLocaleString() },
              { label: "Tokens", value: data.totals.tokens.toLocaleString() },
              { label: "Searches (keyed)", value: searchTotal.toLocaleString() },
              { label: "Email checks", value: data.totals.emailChecks.toLocaleString() },
            ].map((t) => (
              <div key={t.label} className="rounded-xl bg-panel px-4 py-3">
                <p className="text-xs text-muted">{t.label}</p>
                <p className="mt-0.5 text-2xl font-bold tabular-nums text-ink">{t.value}</p>
              </div>
            ))}
          </div>

          <Panel title="Tokens over the period" hint="Every bot's model tokens (prompt and reply), all providers together.">
            <TokenBars report={data} />
          </Panel>

          <Panel title="By provider" hint="Model calls and tokens per provider over the period, most tokens first.">
            {data.hosts.length ? (
              <div className="-mx-4 overflow-x-auto px-4">
                <SortableTable className="w-full min-w-[32rem] text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th className="py-1.5 pr-3 font-medium">Provider</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Calls</th>
                      <th className="py-1.5 pr-3 text-right font-medium">Tokens</th>
                      <th className="py-1.5 font-medium">Share of tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.hosts.map((h) => (
                      <tr key={h.host} className="border-t border-line">
                        <td className="py-1.5 pr-3 text-ink">{h.host}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{h.calls.toLocaleString()}</td>
                        <td className="py-1.5 pr-3 text-right tabular-nums">{h.tokens.toLocaleString()}</td>
                        <td className="py-1.5">
                          <Share part={h.tokens} whole={data.totals.tokens} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </SortableTable>
              </div>
            ) : (
              <p className="text-sm text-muted">No model calls recorded in this period.</p>
            )}
          </Panel>

          <Panel title="By bot" hint="Each bot's model tokens over the period.">
            {data.bots.length ? (
              <SortableTable className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1.5 pr-3 font-medium">Bot</th>
                    <th className="py-1.5 pr-3 text-right font-medium">Tokens</th>
                    <th className="py-1.5 font-medium">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.bots.map((b) => (
                    <tr key={b.name} className="border-t border-line first:border-t-0">
                      <td className="py-1.5 pr-3 text-ink">{b.name}</td>
                      <td className="py-1.5 pr-3 text-right tabular-nums">{b.tokens.toLocaleString()}</td>
                      <td className="w-32 py-1.5">
                        <Share part={b.tokens} whole={data.totals.tokens} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </SortableTable>
            ) : (
              <p className="text-sm text-muted">No bot tokens recorded in this period.</p>
            )}
          </Panel>

          <Panel title="Searches and checks" hint="Keyed searches the bots made (FreeSerp is keyless and not counted), and email addresses checked with QuickEmailVerification.">
            <ul className="space-y-1 text-sm">
              {["tavily", "langsearch", "parallel"].map((k) => (
                <li key={k} className="flex justify-between border-t border-line py-1.5 first:border-t-0">
                  <span className="text-ink">{SEARCH_NAMES[k]} searches</span>
                  <span className="tabular-nums">{(data.totals.searches[k] ?? 0).toLocaleString()}</span>
                </li>
              ))}
              <li className="flex justify-between border-t border-line py-1.5">
                <span className="text-ink">Email checks</span>
                <span className="tabular-nums">{data.totals.emailChecks.toLocaleString()}</span>
              </li>
            </ul>
          </Panel>
        </>
      )}
    </div>
  );
}
