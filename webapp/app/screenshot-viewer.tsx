"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { when } from "@/lib/format";
import { useVisibleInterval } from "./hooks";
import CopyButton from "./copy-button";
import { buttonClass, Icon } from "./ui";
import type { ScreenshotList } from "@/lib/screenshots";

const navButton = buttonClass("gray", "sm");

/** The live screenshot, with Previous / Next through the saved ones. */
export default function ScreenshotViewer({ slug, screenshotAt }: { slug: string; screenshotAt: string | null }) {
  const [list, setList] = useState<ScreenshotList | null>(null);
  // null = following the live picture; otherwise the id of a saved picture. An id, not an index: the list reloads
  // newest first whenever the bot takes a picture, and an index would silently move onto a different one.
  const [pinned, setPinned] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/bots/${slug}/screenshots`, { cache: "no-store" });
      if (res.ok) setList((await res.json()) as ScreenshotList);
    } catch {
      /* keep the last list */
    }
  }, [slug]);

  // Every 20 s, and at once when the bot takes a new picture.
  useVisibleInterval(() => void load(), 20000);
  const firstAt = useRef(screenshotAt);
  useEffect(() => {
    if (screenshotAt === firstAt.current) return; // the interval's first tick already loads the initial list
    firstAt.current = screenshotAt;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load, screenshotAt]);

  const items = list?.items ?? [];
  const pinnedAt = pinned !== null ? items.findIndex((x) => x.id === pinned) : -1;
  const index = pinnedAt >= 0 ? pinnedAt : null; // a pinned picture that aged out of the list falls back to live
  const live = index === null;
  const setIndex = (next: (i: number | null) => number | null) => {
    const i = next(index);
    setPinned(i === null ? null : (items[i]?.id ?? null));
  };
  // While live, the newest saved picture is usually the live one itself, so "Previous" skips it.
  const liveIsSaved = list?.latestId !== null && list?.latestId === items[0]?.id;
  const olderFromLive = liveIsSaved ? 1 : 0;
  const hasLive = screenshotAt !== null;

  const shownIndex = live ? (liveIsSaved ? 0 : null) : index;
  const item = shownIndex !== null ? items[shownIndex] : undefined;
  const canOlder = live ? items.length > olderFromLive : index < items.length - 1;
  const canNewer = !live && (hasLive || index > 0);

  const older = () => setIndex((i) => (i === null ? olderFromLive : Math.min(items.length - 1, i + 1)));
  const newer = () =>
    setIndex((i) => {
      if (i === null) return null;
      const next = i - 1;
      return next < (hasLive ? olderFromLive : 0) ? (hasLive ? null : 0) : next;
    });

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft" && canOlder) older();
    if (e.key === "ArrowRight" && canNewer) newer();
  };

  const src = live
    ? hasLive
      ? `/api/bots/${slug}/screenshot?at=${encodeURIComponent(screenshotAt)}`
      : null
    : item
      ? `/api/bots/${slug}/screenshots/${item.id}`
      : null;

  const position = shownIndex !== null && items.length ? `${items.length - shownIndex} of ${items.length}` : null;

  return (
    <div tabIndex={0} onKeyDown={onKey} className="rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- local images that change every few seconds
        <img src={src} alt={live ? "Latest browser screenshot from the bot" : `Earlier screenshot from ${item ? when(item.at) : "the bot"}`} className="w-full rounded-lg bg-grouped-3" />
      ) : (
        <p className="rounded-lg bg-grouped-3 px-3 py-8 text-center text-sm text-muted">
          {items.length ? "No live picture: the current page was read as text. Earlier pictures are saved." : "No screenshot yet."}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={older} disabled={!canOlder} className={navButton} aria-label="Previous screenshot">
            <Icon name="chevron-left" className="h-3.5 w-3.5" /> Previous
          </button>
          <button type="button" onClick={newer} disabled={!canNewer} className={navButton} aria-label="Next screenshot">
            Next <Icon name="chevron-right" className="h-3.5 w-3.5" />
          </button>
          {!live && hasLive ? (
            <button type="button" onClick={() => setPinned(null)} className={`${navButton} text-accent`}>
              Latest
            </button>
          ) : null}
          {items.length ? (
            <Link href={`/bots/${slug}/screenshots`} className={navButton} aria-label={`All ${items.length} saved screenshots as a grid`} title="All saved screenshots">
              <Icon name="grid" className="h-3.5 w-3.5" />
            </Link>
          ) : null}
        </div>
        <span className="text-xs text-muted tabular-nums">
          {live ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-sys-green" />
              live{position ? ` · ${position}` : ""}
            </span>
          ) : (
            <>
              {position} · {item ? when(item.at) : ""}
            </>
          )}
        </span>
      </div>
      {!live && item?.url ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs text-muted">
          <a href={item.url} target="_blank" rel="noreferrer" className="min-w-0 truncate hover:text-accent hover:underline">
            {item.url}
          </a>
          <CopyButton text={item.url} what="page address" />
        </p>
      ) : null}
      {list && items.length === 0 && hasLive ? <p className="mt-1.5 text-xs text-muted">Earlier pictures are saved from now on, up to {list.max} per bot.</p> : null}
    </div>
  );
}
