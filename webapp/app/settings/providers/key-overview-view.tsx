"use client";

import { useState } from "react";
import type { KeyOverview, KeyRow, UsageBar } from "@/lib/key-overview";
import { ago } from "@/lib/format";
import { keyPage, NEEDS_FIX } from "@/lib/key-pages";
import { sortOrder, sortValue } from "@/lib/sort-value";
import type { Verdict } from "@/lib/provider-finds";
import KeyRowActions, { MarksContext } from "./key-row-actions";
import { useNow, usePoll } from "../../hooks";
import { buttonClass, Icon, Panel, Spinner } from "../../ui";

const DOT: Record<KeyRow["available"], string> = {
  ready: "bg-sys-green",
  "on file": "bg-sys-blue",
  limited: "bg-sys-orange",
  paused: "bg-sys-red",
  "not working": "bg-sys-red",
  unused: "bg-sys-gray",
  "no key": "bg-sys-gray",
};
const LABEL: Record<KeyRow["available"], string> = {
  ready: "Ready",
  "on file": "On file (not tested)",
  limited: "Hit a limit today",
  paused: "Paused now",
  "not working": "Not working",
  unused: "Unused",
  "no key": "No key",
};

/** "Resets in 5h" / "in 3d" / "in 12m" from an ISO time. */
function resetsIn(iso: string | null, now: number): string {
  if (!iso || !now) return "";
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return "Resets now";
  const m = Math.round(ms / 60000);
  if (m < 1) return "Resets in under a minute";
  return `Resets in ${m < 60 ? `${m}m` : m < 48 * 60 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`}`;
}

/** One quota as a meter: label and percent on a line, a thin bar, then the reset and the numbers. Grey while there is
 * room, orange from half, red from 80 % (over 100 % stays full and red). */
function Meter({ bar, now }: { bar: UsageBar; now: number }) {
  const pct = bar.limit ? Math.round((bar.used / bar.limit) * 100) : null;
  const fill = pct === null ? 0 : Math.min(100, Math.max(0, pct));
  const tone = bar.badge === "Paused" ? "bg-sys-red" : bar.badge ? "bg-sys-gray" : pct === null ? "bg-sys-gray" : pct >= 80 ? "bg-sys-red" : pct >= 50 ? "bg-sys-orange" : "bg-sys-gray";
  return (
    <div className={bar.sub ? "border-l-2 border-line pl-3" : ""}>
      <div className="flex items-baseline justify-between gap-3">
        <span className={`min-w-0 truncate text-sm ${bar.sub ? "text-ink/85" : "font-medium text-ink"}`}>{bar.label}</span>
        <span className={`shrink-0 text-sm tabular-nums ${pct !== null && pct >= 80 ? "font-semibold text-bad" : "text-ink/85"}`}>{bar.badge ?? (pct === null ? "no cap" : `${pct}%`)}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill-3" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={fill} aria-label={bar.label}>
        <div className={`h-full rounded-full ${tone} transition-[width] duration-700`} style={{ width: `${fill}%` }} />
      </div>
      <p className="mt-1 flex flex-wrap justify-between gap-x-3 text-xs text-muted">
        <span title={bar.resetNote}>{bar.badge === "Paused" ? resetsIn(bar.resetsAt, now).replace("Resets", "Back") : resetsIn(bar.resetsAt, now)}</span>
        <span className="tabular-nums">{bar.detail}</span>
      </p>
    </div>
  );
}

// Which usage meter belongs to which key, so the All keys table can draw the same bar.
const QUOTA_OF: Record<string, (label: string) => boolean> = {
  quickemailverification: (l) => l.startsWith("Email checks"),
  tavily: (l) => l === "Tavily searches today",
  groq: (l) => l.startsWith("Groq tokens"),
  openrouter: (l) => l.startsWith("OpenRouter"),
};

/** The Today cell of a key: its words, then a bar -- against its free limit when one is known (grey, orange from
 * half, red from 80 %, as in the meters above), otherwise its share of the fleet's model calls today (blue). */
function TodayBar({ row, bars, totalCalls }: { row: KeyRow; bars: UsageBar[]; totalCalls: number }) {
  const quota = bars.find((b) => QUOTA_OF[row.name]?.(b.label)) ?? bars.find((b) => b.badge && b.label.startsWith(`${row.name} `));
  let fill = 0;
  let tone = "bg-sys-blue/70";
  let caption = "";
  if (quota?.badge) {
    fill = 100;
    tone = "bg-sys-red";
    caption = "paused";
  } else if (quota && quota.limit) {
    const pct = Math.round((quota.used / quota.limit) * 100);
    fill = Math.min(100, pct);
    tone = pct >= 80 ? "bg-sys-red" : pct >= 50 ? "bg-sys-orange" : "bg-sys-gray";
    // A provider that refused every try shows 0 calls but limit hits: say so, not "0% used".
    caption = quota.used === 0 && row.limitHits24h > 0 ? "refused before any call counted" : `${pct}% of its free limit`;
  } else if (row.kind === "AI model" && totalCalls > 0) {
    fill = Math.round((row.callsToday / totalCalls) * 100);
    caption = row.callsToday ? `${fill}% of today's model calls` : "";
  }
  return (
    <div className="min-w-0">
      <span className="block text-ink/85">{row.today}</span>
      {quota || (row.kind === "AI model" && totalCalls > 0) ? (
        <>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-fill-3">
            <div className={`h-full rounded-full ${tone} transition-[width] duration-700`} style={{ width: `${fill}%` }} />
          </div>
          {caption ? <span className="mt-0.5 block text-[11px] text-muted">{caption}</span> : null}
        </>
      ) : null}
    </div>
  );
}

/** 10,978,864 -> "11.0M"; under ten thousand as it is. */
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}k` : n.toLocaleString());

/** "1st for Lead Enricher, Lead Gen, Outreach Writer, ...; 2nd for Outreach Writer" -> "1st for 6 bots · 2nd for
 *  Outreach Writer": a group of three or more bots by its count (the names stay in the hover title). */
function shortPosition(position: string): string {
  return position
    .split("; ")
    .map((part) => {
      const m = /^(\S+) for (.+)$/.exec(part);
      if (!m) return part;
      const names = m[2].split(", ");
      return names.length >= 3 ? `${m[1]} for ${names.length} bots` : part;
    })
    .join(" · ");
}

function StatusLine({ row }: { row: KeyRow }) {
  return (
    <span className="flex items-center gap-1.5 whitespace-nowrap">
      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[row.available]}`} role="img" aria-label={LABEL[row.available]} />
      {LABEL[row.available]}
    </span>
  );
}

/** Where to fix a key that is refused, limited, paused or missing (owner, 2026-11-12): the provider's key page and the
 *  file a new key goes into. A limited or paused key usually only waits; its page shows the plan and the usage. */
function FixLine({ row: r }: { row: KeyRow }) {
  if (!(NEEDS_FIX as readonly string[]).includes(r.available)) return null;
  const page = keyPage(r.name);
  const file = `common-data/keys/${r.file ?? `${r.name}.key`}`;
  // a new key only when the key itself was refused (401/403, rejected, invalid) or is missing; a provider that did not
  // answer (an empty reply, a timeout) needs a Test, not a key (owner, 2026-11-12)
  const refused = r.available === "no key" || (r.available === "not working" && /\b(401|403)\b|reject|invalid|unauthori[sz]ed|refused/i.test(r.note));
  if (r.available === "not working" && !refused)
    return <span className="mt-1 block text-xs break-words text-ink">Press Test: if it passes, the key is fine and the provider was only busy; the bots clear this on their next good call.</span>;
  return (
    <span className="mt-1 block text-xs break-words text-ink">
      {page ? (
        <>
          {refused ? "Fix: make a new key at " : "Check the plan at "}
          <a href={page.url} target="_blank" rel="noopener noreferrer" className="font-medium text-accent underline">
            {page.host}
          </a>
          {refused ? (
            <>
              , then save it as <code className="break-all">{file}</code>
            </>
          ) : null}
        </>
      ) : refused ? (
        <>
          Fix: save a working key as <code className="break-all">{file}</code>
        </>
      ) : null}
    </span>
  );
}

/** One key as a row that fits the panel: on a wide screen five columns (key and who uses it, status, today, free limit,
 *  limit hits), on a phone stacked; no sideways scroll. */
function KeyLine({ row: r, bars, totalCalls, now }: { row: KeyRow; bars: UsageBar[]; totalCalls: number; now: number }) {
  const used = r.position ? shortPosition(r.position) : r.usedBy.join(", ");
  const full = [r.position || r.usedBy.join(", "), r.stoppedBy?.length ? `stopped: ${r.stoppedBy.join(", ")}` : ""].filter(Boolean).join(" · ");
  return (
    <li className="grid grid-cols-1 gap-x-4 gap-y-1.5 py-3 text-sm md:grid-cols-[minmax(0,13rem)_minmax(0,14rem)_minmax(0,1fr)_minmax(0,9rem)_4.5rem]">
      <div className="min-w-0">
        {keyPage(r.name) ? (
          // every provider's key page (owner, 2026-11-12: "link on all rows so I can add new to our Ramen")
          <a href={keyPage(r.name)!.url} target="_blank" rel="noopener noreferrer" className="block font-semibold break-words text-ink underline decoration-line underline-offset-2 hover:text-accent"
             title={`Make or replace the key at ${keyPage(r.name)!.host}`}>
            {r.name} ↗
          </a>
        ) : (
          <span className="block font-semibold break-words text-ink">{r.name}</span>
        )}
        <span className="block text-xs text-muted">
          {r.kind}
          {r.paid ? " · paid" : ""}
        </span>
        {used ? (
          <span className="mt-0.5 line-clamp-3 text-xs break-words text-ink/75" title={full}>
            {used}
          </span>
        ) : null}
      </div>
      <div className="min-w-0">
        <StatusLine row={r} />
        {r.note ? (
          <span className="mt-0.5 line-clamp-2 text-xs break-words text-muted" title={r.note}>
            {r.note}
          </span>
        ) : null}
        <FixLine row={r} />
      </div>
      <div className="min-w-0 text-xs">
        <TodayBar row={r} bars={bars} totalCalls={totalCalls} />
        {/* Test and Usable / Unusable on every key, under the Today bar (owner, 2026-11-12) */}
        {r.file || r.available !== "no key" ? <KeyRowActions name={r.name} kind={r.kind} /> : null}
      </div>
      <div className="min-w-0 text-xs break-words text-muted">
        <span className="text-muted md:hidden">Free limit: </span>
        {r.free || "–"}
      </div>
      <div className="text-xs tabular-nums md:text-right">
        <span className="text-muted md:hidden">Limit hits, 24 h: </span>
        {r.limitHits24h ? (
          <span className="text-sys-orange" title={r.lastLimit ? `last ${ago(r.lastLimit, now)}` : undefined}>
            {r.limitHits24h}
            <span className="block text-[11px]">{r.lastLimit ? ago(r.lastLimit, now) : ""}</span>
          </span>
        ) : (
          <span className="text-muted">0</span>
        )}
      </div>
    </li>
  );
}

// The key list's columns, sortable like every table (owner, 2026-11-12): a heading click sorts, again reverses, a third
// time restores the page's own order; on a phone a menu does the same.
const KEY_COLS: { label: string; value: (r: KeyRow) => string | number; right?: boolean }[] = [
  { label: "Key · used by", value: (r) => r.name },
  { label: "Status", value: (r) => r.available },
  { label: "Today", value: (r) => r.tokensToday || r.callsToday },
  { label: "Free limit", value: (r) => r.free },
  { label: "Limit hits, 24 h", value: (r) => r.limitHits24h, right: true },
];

function KeyGroup({ title, rows, empty, bars, totalCalls, now }: { title: string; rows: KeyRow[]; empty?: string; bars: UsageBar[]; totalCalls: number; now: number }) {
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  if (!rows.length && !empty) return null;
  const click = (col: number) => setSort((s) => (!s || s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null));
  const shown = sort ? sortOrder(rows.map((r) => sortValue(KEY_COLS[sort.col].value(r))), sort.dir).map((i) => rows[i]) : rows;
  return (
    <section className="mt-4 first:mt-0">
      <h3 className="flex flex-wrap items-baseline gap-2 text-sm font-semibold text-ink">
        {title} <span className="text-xs font-normal text-muted tabular-nums">{rows.length}</span>
        {rows.length > 1 ? (
          <select
            aria-label={`Sort ${title}`}
            value={sort ? `${sort.col}-${sort.dir}` : ""}
            onChange={(e) => setSort(e.target.value ? { col: Number(e.target.value.split("-")[0]), dir: e.target.value.split("-")[1] as "asc" | "desc" } : null)}
            className="ml-auto rounded-md bg-fill-3 px-2 py-0.5 text-xs font-normal text-ink md:hidden"
          >
            <option value="">Page order</option>
            {KEY_COLS.flatMap((c, i) => [
              <option key={`${i}-asc`} value={`${i}-asc`}>{c.label} ↑</option>,
              <option key={`${i}-desc`} value={`${i}-desc`}>{c.label} ↓</option>,
            ])}
          </select>
        ) : null}
      </h3>
      {rows.length ? (
        <>
          <div role="row" className="mt-1 hidden grid-cols-[minmax(0,13rem)_minmax(0,14rem)_minmax(0,1fr)_minmax(0,9rem)_4.5rem] gap-x-4 border-b border-line pb-1 text-xs text-muted md:grid">
            {KEY_COLS.map((c, i) => {
              const on = sort?.col === i;
              return (
                <span key={c.label} role="columnheader" aria-sort={on ? (sort!.dir === "asc" ? "ascending" : "descending") : "none"} className={c.right ? "text-right" : ""}>
                  <button type="button" onClick={() => click(i)} className="inline-flex items-center gap-1 hover:text-ink" title="Sort by this column">
                    {c.label}
                    <span aria-hidden className={`text-[10px] ${on ? "text-ink" : "text-muted/60"}`}>{on ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}</span>
                  </button>
                </span>
              );
            })}
          </div>
          <ul className="divide-y divide-line">
            {shown.map((r) => (
              <KeyLine key={r.name} row={r} bars={bars} totalCalls={totalCalls} now={now} />
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-1 text-sm text-muted">{empty}</p>
      )}
    </section>
  );
}

/** Keys on file nobody has tried, and keys not in use: one short line each. */
function IdleList({ rows }: { rows: KeyRow[] }) {
  return (
    <ul className="mt-2 divide-y divide-line">
      {rows.map((r) => (
        <li key={r.name} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-1.5 text-xs">
          {keyPage(r.name) ? (
            <a href={keyPage(r.name)!.url} target="_blank" rel="noopener noreferrer" className="w-36 shrink-0 font-semibold text-ink underline decoration-line underline-offset-2 hover:text-accent"
               title={`Make or replace the key at ${keyPage(r.name)!.host}`}>
              {r.name} ↗
            </a>
          ) : (
            <span className="w-36 shrink-0 font-semibold text-ink">{r.name}</span>
          )}
          <span className="w-20 shrink-0 text-muted">{r.kind}</span>
          <span className="min-w-0 flex-1 break-words text-muted">{r.note || r.free || "–"}</span>
          {r.file ? (
            <div className="w-full">
              <KeyRowActions name={r.name} kind={r.kind} />
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

type UsageSort = "used" | "name" | "resets";
const USAGE_SHOWN = 6;

/** The bars as units: a bar and the bots drawn under it (sub) stay together when sorted. */
function usageUnits(list: UsageBar[]): UsageBar[][] {
  const units: UsageBar[][] = [];
  for (const b of list) {
    if (b.sub && units.length) units[units.length - 1].push(b);
    else units.push([b]);
  }
  return units;
}
const usedShare = (b: UsageBar) => (b.limit ? b.used / b.limit : -1);

/** Usage and token budget (owner, 2026-11-12): sortable (most used, name, resets soonest), the bars in two columns on a
 *  wide screen, the first six and "Show all n". */
function UsagePanel({ bars, now }: { bars: UsageBar[]; now: number }) {
  const [sort, setSort] = useState<UsageSort>("used");
  const [all, setAll] = useState<Record<string, boolean>>({});
  const groups = (["Free quotas", "Bot daily budgets"] as const).filter((g) => bars.some((b) => b.group === g));
  const order = (units: UsageBar[][]) =>
    [...units].sort((x, y) => {
      const a = x[0], b = y[0];
      if (sort === "name") return a.label.localeCompare(b.label);
      if (sort === "resets") return (a.resetsAt ?? "9999").localeCompare(b.resetsAt ?? "9999") || a.label.localeCompare(b.label);
      return usedShare(b) - usedShare(a) || a.label.localeCompare(b.label);
    });
  return (
    <section className="space-y-5">
      {groups.map((g) => {
        const units = order(usageUnits(bars.filter((b) => b.group === g)));
        if (!units.length) return null;
        const open = all[g] || units.length <= USAGE_SHOWN;
        const shown = open ? units : units.slice(0, USAGE_SHOWN);
        return (
          <div key={g} className="rounded-xl bg-panel px-4 pt-3.5 pb-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{g === "Free quotas" ? "Usage" : "Token budget"}</h2>
              <label className="flex items-center gap-1.5 text-xs text-muted">
                Sort
                <select value={sort} onChange={(e) => setSort(e.target.value as UsageSort)} className="rounded-md bg-fill-3 px-2 py-1 text-xs text-ink">
                  <option value="used">Most used first</option>
                  <option value="name">Name</option>
                  <option value="resets">Resets soonest</option>
                </select>
              </label>
            </div>
            <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-4 md:grid-cols-2">
              {shown.map((u) => (
                <div key={u[0].label} className="space-y-3">
                  {u.map((b) => (
                    <Meter key={b.label} bar={b} now={now} />
                  ))}
                </div>
              ))}
            </div>
            {units.length > USAGE_SHOWN ? (
              <button type="button" onClick={() => setAll((m) => ({ ...m, [g]: !open }))} className="mt-3 text-xs font-semibold text-accent hover:underline" aria-expanded={open}>
                {open ? "Show fewer" : `Show all ${units.length}`}
              </button>
            ) : null}
          </div>
        );
      })}
    </section>
  );
}

/** Every key in one view: availability, today's usage, free limit and where it sits in the bots' chains. */
export default function KeyOverviewView() {
  const feed = usePoll<KeyOverview>("key-overview", 60000);
  const finds = usePoll<{ decided: Verdict[] }>("provider-finds", 5 * 60_000);
  const [fresh, setFresh] = useState<KeyOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const now = useNow(60000);
  const data = fresh ?? feed.data;

  async function refresh() {
    setBusy(true);
    try {
      const r = await fetch("/api/key-overview?fresh=1", { cache: "no-store" });
      if (r.ok) setFresh((await r.json()) as KeyOverview);
    } finally {
      setBusy(false);
    }
  }

  if (!data) {
    return feed.error ? (
      <p className="rounded-xl bg-sys-red/10 p-4 text-sm text-bad">{feed.error}</p>
    ) : (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Reading keys, logs and usage…
      </p>
    );
  }
  const rows = data.rows;
  // Keys nothing uses (paid ones kept off every chain, providers with no key) fold away under the working ones.
  const idle = rows.filter((r) => r.available === "unused" || r.available === "no key");
  // Three groups, so what needs a look is first and the keys nobody has tried yet fold away (owner 2026-11-06: "UX
  // here is poor": one 34-row table, the broken and limited keys lost among the idle ones).
  const attention = rows.filter((r) => r.available === "not working" || r.available === "limited" || r.available === "paused");
  const working = rows.filter((r) => r.available === "ready");
  const onFile = rows.filter((r) => r.available === "on file");
  const totalCalls = rows.filter((r) => r.kind === "AI model").reduce((t, r) => t + r.callsToday, 0);
  const count = (a: KeyRow["available"][]) => rows.filter((r) => a.includes(r.available)).length;
  const tokens = data.fleetTokens ?? rows.reduce((t, r) => t + r.tokensToday, 0); // the same count as the token pool
  const tiles = [
    { label: "Keys on this Mac", value: rows.filter((r) => r.file).length, tone: "text-ink" },
    { label: "Ready", value: count(["ready", "on file"]), tone: "text-good" },
    { label: "Limited or paused today", value: count(["limited", "paused"]), tone: "text-sys-orange" },
    { label: "Not working", value: count(["not working"]), tone: "text-bad" },
    { label: "Fleet tokens today", value: compact(tokens), title: tokens.toLocaleString(), tone: "text-ink" },
  ];

  return (
    <MarksContext.Provider value={{ marks: finds.data?.decided ?? [], reload: finds.reload, tested: () => void refresh() }}>
    <div className="space-y-5">
      {data.usage?.length ? <UsagePanel bars={data.usage} now={now} /> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="min-w-0 rounded-xl bg-panel px-4 py-3" title={"title" in t ? t.title : undefined}>
            <p className="truncate text-xs text-muted">{t.label}</p>
            <p className={`mt-0.5 truncate text-2xl font-bold tabular-nums ${t.tone}`}>{t.value}</p>
          </div>
        ))}
      </div>

      <Panel
        title="All keys"
        hint="Availability from the bots' own logs (a provider that hits its rate limit or daily cap is skipped for the time the engine sets: 15 minutes, an hour for OpenRouter) and the services' free checks. Usage is every bot's, today."
        aside={
          <button type="button" onClick={() => void refresh()} disabled={busy} className={buttonClass("plain", "sm")}>
            {busy ? <Spinner small /> : <Icon name="arrow-clockwise" className="h-3.5 w-3.5" />} Refresh
          </button>
        }
      >
        <KeyGroup title="Needs attention" rows={attention} empty="Nothing: every key in use answers." bars={data.usage ?? []} totalCalls={totalCalls} now={now} />
        <KeyGroup title="Working" rows={working} bars={data.usage ?? []} totalCalls={totalCalls} now={now} />
        {onFile.length ? (
          <details className="mt-4 border-t border-line pt-3">
            <summary className="cursor-pointer text-sm font-semibold text-muted">On file, not tested ({onFile.length})</summary>
            <IdleList rows={onFile} />
          </details>
        ) : null}
        {idle.length ? (
          <details className="mt-3 border-t border-line pt-3">
            <summary className="cursor-pointer text-sm font-semibold text-muted">Not in use ({idle.length})</summary>
            <IdleList rows={idle} />
          </details>
        ) : null}
      </Panel>

      {data.watch ? (
        <p className="text-xs text-muted">
          Free-terms watch, {data.watch.date}
          {now ? ` (${ago(data.watch.date.replace(" ", "T"), now)})` : ""}: {data.watch.changed} provider page{data.watch.changed === "1" ? "" : "s"} changed
          {data.watch.headline ? ` (${data.watch.headline})` : ""}. Full report: common-data/provider-watch-report.md.
        </p>
      ) : null}
    </div>
    </MarksContext.Provider>
  );
}
