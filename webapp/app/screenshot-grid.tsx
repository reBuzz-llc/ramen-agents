"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BotProfile } from "@/lib/bot";
import type { ScreenshotList } from "@/lib/screenshots";
import { ago, when } from "@/lib/format";
import AppChrome from "./app-chrome";
import CopyButton from "./copy-button";
import { useNow, useVisibleInterval } from "./hooks";
import { buttonClass, Icon, Panel, Spinner } from "./ui";

/** The page a picture was taken on, as a short label: "news.ycombinator.com", "Own files". */
function host(url: string | null): string {
  if (!url) return "Saved page";
  if (url.startsWith("corpus://")) return "Own files";
  try {
    return new URL(url).host.replace(/^www\./, "") || "Saved page";
  } catch {
    return url.slice(0, 40);
  }
}

function dayLabel(iso: string, now: number): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "Undated";
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(new Date(now || Date.now())) - midnight(d)) / 86400e3);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/** Every saved screenshot at once, newest first, with a full-size viewer. */
export default function ScreenshotGrid({ bot }: { bot: BotProfile }) {
  const [list, setList] = useState<ScreenshotList | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The open picture by id, not by position: the list reloads newest first, so an index drifts onto another picture.
  const [openId, setOpenId] = useState<string | null>(null);
  const now = useNow(30000);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/bots/${bot.slug}/screenshots`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setList((await res.json()) as ScreenshotList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "request failed");
    }
  }, [bot.slug]);
  useVisibleInterval(() => void load(), 30000);

  const items = useMemo(() => list?.items ?? [], [list]);
  const found = openId !== null ? items.findIndex((x) => x.id === openId) : -1;
  const open = found >= 0 ? found : null;
  const shown = open !== null ? items[open] : undefined;
  const setOpen = (next: number | null | ((i: number | null) => number | null)) => {
    const i = typeof next === "function" ? next(open) : next;
    setOpenId(i === null ? null : (items[i]?.id ?? null));
  };

  // Arrow keys move through the full-size viewer; Escape closes it.
  useEffect(() => {
    if (open === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenId(null);
      if (e.key === "ArrowRight") setOpenId(items[Math.min(items.length - 1, open + 1)]?.id ?? null);
      if (e.key === "ArrowLeft") setOpenId(items[Math.max(0, open - 1)]?.id ?? null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, items]);

  return (
    <AppChrome
      title="Screenshots"
      subtitle={items.length ? `Every page ${bot.name} pictured, newest first` : `What ${bot.name} saw`}
      actions={
        <Link href={`/bots/${bot.slug}`} className={`${buttonClass("glass", "md")}`}>
          <Icon name="chevron-left" className="h-4 w-4" />
          Dashboard
        </Link>
      }
    >
      {error && !list ? (
        <p className="rounded-xl bg-sys-red/10 p-4 text-sm text-bad">Could not load the screenshots: {error}</p>
      ) : !list ? (
        <p className="flex items-center gap-2 text-sm text-muted">
          <Spinner /> Loading…
        </p>
      ) : !items.length ? (
        <Panel title="Nothing saved yet">
          <p className="text-sm text-muted">
            {bot.name} has not saved a picture yet. The dashboard keeps the last {list.max} pages it saw, from the
            moment it first takes one.
          </p>
        </Panel>
      ) : (
        <Panel title="Saved pages" aside={`${items.length} of ${list.max} kept`}>
          <ul className="grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item, i) => (
              <li key={item.id} className="min-w-0">
                <figure className="min-w-0">
                  <button
                    type="button"
                    onClick={() => setOpen(i)}
                    className="pressable block w-full overflow-hidden rounded-xl bg-grouped-3 ring-line hover:ring-2 focus-visible:ring-2 focus-visible:ring-accent/50"
                    aria-label={`Open the screenshot from ${when(item.at)}`}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element -- local images served by the dashboard */}
                    <img
                      src={`/api/bots/${bot.slug}/screenshots/${item.id}`}
                      alt={`Page ${bot.name} saw at ${when(item.at)}`}
                      loading="lazy"
                      className="aspect-[4/3] w-full bg-grouped-3 object-cover object-top"
                    />
                  </button>
                  <figcaption className="mt-1.5 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-xs font-semibold text-ink">{host(item.url)}</span>
                      <span className="shrink-0 text-xs text-muted" title={when(item.at)}>
                        {item.at ? ago(item.at, now) : ""}
                      </span>
                    </div>
                    <div className="text-xs text-muted">{item.at ? dayLabel(item.at, now) : ""}</div>
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {shown ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Screenshot from ${when(shown.at)}`}
          onClick={(e) => e.target === e.currentTarget && setOpen(null)}
          className="fixed inset-0 z-50 flex flex-col bg-black/70 p-3 [animation:fade-in_0.2s_ease-out] sm:p-6"
        >
          <div className="mx-auto flex min-h-0 w-full max-w-[min(80rem,100%)] flex-1 flex-col">
            <div className="glass mb-2 flex items-center gap-2 rounded-full px-2 py-1.5">
              <button
                type="button"
                onClick={() => setOpen((i) => Math.max(0, (i ?? 0) - 1))}
                disabled={open === 0}
                className={buttonClass("plain", "sm")}
                aria-label="Newer screenshot"
              >
                <Icon name="chevron-left" className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setOpen((i) => Math.min(items.length - 1, (i ?? 0) + 1))}
                disabled={open === items.length - 1}
                className={buttonClass("plain", "sm")}
                aria-label="Older screenshot"
              >
                <Icon name="chevron-right" className="h-4 w-4" />
              </button>
              <span className="min-w-0 flex-1 truncate text-xs text-ink">
                {when(shown.at)}
                {shown.url ? <span className="text-muted"> · {shown.url}</span> : null}
              </span>
              <span className="shrink-0 text-xs text-muted tabular-nums">
                {items.length - (open ?? 0)} of {items.length}
              </span>
              {shown.url ? <CopyButton text={shown.url} what="page address" /> : null}
              <button type="button" onClick={() => setOpen(null)} className="pressable hit grid h-8 w-8 place-items-center rounded-full bg-fill-3 text-muted hover:text-ink" aria-label="Close">
                <Icon name="xmark" className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-xl bg-panel">
              {/* eslint-disable-next-line @next/next/no-img-element -- local image */}
              <img src={`/api/bots/${bot.slug}/screenshots/${shown.id}`} alt={`Page ${bot.name} saw at ${when(shown.at)}`} className="w-full" />
            </div>
          </div>
        </div>
      ) : null}
    </AppChrome>
  );
}
