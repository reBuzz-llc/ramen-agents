"use client";

import { useState } from "react";
import type { KeyOverview, KeyRow, UsageBar } from "@/lib/key-overview";
import { ago } from "@/lib/format";
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
    <div className="min-w-[10rem]">
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

function UsagePanel({ bars, now }: { bars: UsageBar[]; now: number }) {
  const groups = ["Free quotas", "Bot daily budgets"] as const;
  return (
    <section className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {groups.map((g) => {
        const list = bars.filter((b) => b.group === g);
        if (!list.length) return null;
        return (
          <div key={g} className="rounded-xl bg-panel px-4 pt-3.5 pb-4">
            <h2 className="text-xs font-semibold tracking-wide text-muted uppercase">{g === "Free quotas" ? "Usage" : "Token budget"}</h2>
            <div className="mt-3 space-y-4">
              {list.map((b) => (
                <Meter key={b.label} bar={b} now={now} />
              ))}
            </div>
          </div>
        );
      })}
    </section>
  );
}

/** Every key in one view: availability, today's usage, free limit and where it sits in the bots' chains. */
export default function KeyOverviewView() {
  const feed = usePoll<KeyOverview>("key-overview", 60000);
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
  const active = rows.filter((r) => !idle.includes(r));
  const totalCalls = rows.filter((r) => r.kind === "AI model").reduce((t, r) => t + r.callsToday, 0);
  const count = (a: KeyRow["available"][]) => rows.filter((r) => a.includes(r.available)).length;
  const tokens = data.fleetTokens ?? rows.reduce((t, r) => t + r.tokensToday, 0); // the same count as the token pool
  const tiles = [
    { label: "Keys on this Mac", value: rows.filter((r) => r.file).length, tone: "text-ink" },
    { label: "Ready", value: count(["ready", "on file"]), tone: "text-good" },
    { label: "Limited or paused today", value: count(["limited", "paused"]), tone: "text-sys-orange" },
    { label: "Not working", value: count(["not working"]), tone: "text-bad" },
    { label: "Fleet tokens today", value: tokens.toLocaleString(), tone: "text-ink" },
  ];

  return (
    <div className="space-y-5">
      {data.usage?.length ? <UsagePanel bars={data.usage} now={now} /> : null}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-xl bg-panel px-4 py-3">
            <p className="text-xs text-muted">{t.label}</p>
            <p className={`mt-0.5 text-2xl font-bold tabular-nums ${t.tone}`}>{t.value}</p>
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
        <div className="-mx-4 overflow-x-auto px-4">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="text-left text-xs text-muted">
                <th className="py-1.5 pr-3 font-medium">Key</th>
                <th className="py-1.5 pr-3 font-medium">Status</th>
                <th className="py-1.5 pr-3 font-medium">Used by</th>
                <th className="py-1.5 pr-3 font-medium">Today</th>
                <th className="py-1.5 pr-3 font-medium">Free limit</th>
                <th className="py-1.5 font-medium whitespace-nowrap">Limit hits, 24 h</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line align-top">
              {active.map((r) => (
                <tr key={r.name}>
                  <td className="py-2 pr-3">
                    <span className="block font-semibold text-ink">{r.name}</span>
                    <span className="block text-xs text-muted">
                      {r.kind}
                      {r.paid ? " · paid" : ""}
                    </span>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-1.5 whitespace-nowrap">
                      <span className={`h-2 w-2 shrink-0 rounded-full ${DOT[r.available]}`} role="img" aria-label={LABEL[r.available]} />
                      {LABEL[r.available]}
                    </span>
                    {r.note ? (
                      <span className="mt-0.5 line-clamp-2 max-w-[18rem] text-xs break-words text-muted" title={r.note}>
                        {r.note}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-3 text-xs break-words">
                    <span className="text-ink/85">{r.position || r.usedBy.join(", ") || "–"}</span>
                    {r.stoppedBy?.length ? <span className="mt-0.5 block text-muted">stopped: {r.stoppedBy.join(", ")}</span> : null}
                  </td>
                  <td className="py-2 pr-3 text-xs">
                    <TodayBar row={r} bars={data.usage ?? []} totalCalls={totalCalls} />
                  </td>
                  <td className="py-2 pr-3 text-xs text-muted">{r.free || "–"}</td>
                  <td className="py-2 text-xs whitespace-nowrap tabular-nums">
                    {r.limitHits24h ? (
                      <span className="text-sys-orange">
                        {r.limitHits24h} · last {r.lastLimit ? ago(r.lastLimit, now) : ""}
                      </span>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {idle.length ? (
          <details className="mt-3 border-t border-line pt-3">
            <summary className="cursor-pointer text-sm font-semibold text-muted">Not in use ({idle.length})</summary>
            <ul className="mt-2 divide-y divide-line">
              {idle.map((r) => (
                <li key={r.name} className="flex flex-wrap items-baseline gap-x-3 py-1.5 text-xs">
                  <span className="w-32 shrink-0 font-semibold text-ink">{r.name}</span>
                  <span className="text-muted">{LABEL[r.available]}</span>
                  <span className="min-w-0 flex-1 break-words text-muted">{r.note || r.free}</span>
                </li>
              ))}
            </ul>
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
  );
}
