"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { BotProfile } from "@/lib/bot";
import type { VisitPage } from "@/lib/visits";
import { ago, when } from "@/lib/format";
import AppChrome from "./app-chrome";
import CopyButton from "./copy-button";
import { useNow } from "./hooks";
import { buttonClass, Icon, Panel, Spinner } from "./ui";

const PAGE_SIZE = 100;

/** Every page the bot opened, newest first, filtered by site, text or failures. */
export default function VisitsView({ bot }: { bot: BotProfile }) {
  const [page, setPage] = useState<VisitPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [domain, setDomain] = useState("");
  const [q, setQ] = useState("");
  const [typed, setTyped] = useState("");
  const [failed, setFailed] = useState(false);
  const now = useNow(30000);

  // Typing filters as you go, but only once you stop.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(typed);
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [typed]);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ offset: String(offset) });
    if (domain) params.set("domain", domain);
    if (q.trim()) params.set("q", q.trim());
    if (failed) params.set("failed", "1");
    try {
      const res = await fetch(`/api/bots/${bot.slug}/visits?${params}`, { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) setError(body.error ?? `HTTP ${res.status}`);
      else {
        setPage(body as VisitPage);
        setError(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    }
    setLoading(false);
  }, [bot.slug, offset, domain, q, failed]);
  useEffect(() => {
    // Deferred by a tick, like the screenshot viewer: the effect itself must not set state.
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  const visits = page?.visits ?? [];
  const total = page?.total ?? 0;
  const from = total ? offset + 1 : 0;
  const to = offset + visits.length;
  const filtering = Boolean(domain || q.trim() || failed);

  return (
    <AppChrome
      title="Pages visited"
      subtitle={page ? `${total.toLocaleString()} page${total === 1 ? "" : "s"} ${bot.name} opened${filtering ? ", filtered" : ""}` : `Every page ${bot.name} opened`}
      actions={
        <Link href={`/bots/${bot.slug}`} className={buttonClass("glass", "md")}>
          <Icon name="chevron-left" className="h-4 w-4" />
          Dashboard
        </Link>
      }
    >
      {/* Filters: one row above everything they scope. */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <label className="min-w-0 flex-1 sm:max-w-xs">
          <span className="sr-only">Search the pages</span>
          <input
            type="search"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder="Search address or title"
            className="h-8 w-full rounded-full bg-fill-3 px-3.5 text-sm text-ink placeholder:text-muted focus:ring-2 focus:ring-sys-blue/40 focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={failed}
            onChange={(e) => {
              setFailed(e.target.checked);
              setOffset(0);
            }}
            className="h-4 w-4 accent-[var(--accent)]"
          />
          Only pages that failed
        </label>
        {filtering ? (
          <button
            type="button"
            onClick={() => {
              setDomain("");
              setTyped("");
              setQ("");
              setFailed(false);
              setOffset(0);
            }}
            className={buttonClass("plain", "sm")}
          >
            Clear filters
          </button>
        ) : null}
        {loading ? <Spinner /> : null}
      </div>

      {error ? <p className="mb-5 rounded-xl bg-sys-red/10 p-4 text-sm text-bad">Could not load the pages: {error}</p> : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <Panel
          title={domain || "All sites"}
          aside={page ? (total ? `${from}–${to} of ${total.toLocaleString()}` : "none") : undefined}
          className={loading ? "opacity-60 transition-opacity" : "transition-opacity"}
        >
          {!page ? (
            <p className="flex items-center gap-2 text-sm text-muted">
              <Spinner /> Loading…
            </p>
          ) : !visits.length ? (
            <p className="text-sm text-muted">{filtering ? "No page matches these filters." : `${bot.name} has not opened any page yet.`}</p>
          ) : (
            <>
              <ol className="divide-y divide-line">
                {visits.map((v) => (
                  <li key={v.id} className="group flex items-start gap-3 py-2.5">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${v.ok ? "bg-sys-green" : "bg-sys-red"}`} role="img" aria-label={v.ok ? "read" : "failed"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span className="min-w-0 truncate text-sm font-semibold text-ink">{v.title || v.domain || "untitled page"}</span>
                        <span className="shrink-0 text-xs text-muted" title={when(v.at)}>
                          {ago(v.at, now)}
                        </span>
                      </div>
                      <a
                        href={v.url}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-xs text-muted hover:text-accent hover:underline"
                        title={v.url}
                      >
                        {v.url}
                      </a>
                      {v.error ? <p className="mt-0.5 text-xs text-bad">{v.error}</p> : null}
                    </div>
                    <CopyButton text={v.url} what="address" reveal />
                  </li>
                ))}
              </ol>
              <div className="mt-3 flex items-center justify-between gap-3">
                <button type="button" onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))} disabled={offset === 0} className={buttonClass("gray", "sm")}>
                  <Icon name="chevron-left" className="h-3.5 w-3.5" /> Newer
                </button>
                <span className="text-xs text-muted tabular-nums">
                  {from}–{to} of {total.toLocaleString()}
                </span>
                <button type="button" onClick={() => setOffset((o) => o + PAGE_SIZE)} disabled={to >= total} className={buttonClass("gray", "sm")}>
                  Older <Icon name="chevron-right" className="h-3.5 w-3.5" />
                </button>
              </div>
            </>
          )}
        </Panel>

        <aside className="space-y-5 lg:sticky lg:top-[calc(env(safe-area-inset-top)+4.75rem)] lg:self-start">
          <section className="rounded-xl bg-panel p-4 text-sm">
            <h2 className="mb-1 text-lg font-semibold text-ink">Sites</h2>
            <p className="mb-3 text-xs text-muted">Click one to see only its pages.</p>
            <ul className="max-h-[60vh] space-y-0.5 overflow-y-auto">
              <li>
                <button
                  type="button"
                  onClick={() => {
                    setDomain("");
                    setOffset(0);
                  }}
                  className={`pressable flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left ${!domain ? "bg-fill-3 font-semibold text-ink" : "text-ink/85 hover:bg-fill-3"}`}
                >
                  All sites
                </button>
              </li>
              {(page?.domains ?? []).map((d) => (
                <li key={d.domain}>
                  <button
                    type="button"
                    onClick={() => {
                      setDomain(d.domain === domain ? "" : d.domain);
                      setOffset(0);
                    }}
                    className={`pressable flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left ${d.domain === domain ? "bg-fill-3 font-semibold text-ink" : "text-ink/85 hover:bg-fill-3"}`}
                  >
                    <span className="truncate">{d.domain === "raw" ? "Own files (raw/)" : d.domain}</span>
                    <span className="shrink-0 text-xs text-muted tabular-nums">{d.pages.toLocaleString()}</span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </AppChrome>
  );
}
