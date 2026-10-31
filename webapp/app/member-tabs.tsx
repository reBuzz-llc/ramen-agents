"use client";

import { useEffect, useState } from "react";
import type { BotCard, Shoulder } from "@/lib/board";

const BRAND = "#ff6600";

// The member panel's Screen and Feed tabs (2026-10-31: no pop-up anywhere): what the bot sees now
// and its last 20 actions, both from /api/shoulder, refreshed with every board poll while the tab is open.

/** /api/shoulder for one bot, again whenever `tick` changes (the board's read time, every 12 s). */
function useShoulder(slug: string, tick: string): { s: Shoulder | null; error: string } {
  const [view, setView] = useState<{ slug: string; s: Shoulder } | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    fetch(`/api/shoulder?bot=${encodeURIComponent(slug)}`, { cache: "no-store" })
      .then(async (r) => {
        const body = (await r.json()) as Shoulder & { error?: string };
        if (!live) return;
        if (r.ok) {
          setView({ slug, s: body });
          setError("");
        } else setError(body.error ?? `HTTP ${r.status}`);
      })
      .catch(() => live && setError("could not reach the dashboard"));
    return () => {
      live = false;
    };
  }, [slug, tick]);
  return { s: view?.slug === slug ? view.s : null, error };
}

/** Screen: the bot's screenshot (under 10 minutes old) fitted to the panel, else the page it is reading, else the
 *  document or search of its last action. */
export function ScreenTab({ slug, tick, last }: { slug: string; tick: string; last: BotCard["last"] }) {
  const { s, error } = useShoulder(slug, tick);
  return <Screen slug={slug} s={s} last={last} error={error} />;
}

/** Feed: the thinking line on top, then the last 20 actions newest first, refusals dimmed with the reason on hover. */
export function FeedTab({ slug, tick }: { slug: string; tick: string }) {
  const { s, error } = useShoulder(slug, tick);
  if (!s) return <p className="text-xs">{error || "Reading…"}</p>;
  return (
    <div className="space-y-2 font-sans">
      {s.thought ? (
        <p className="text-sm">
          <span className="font-semibold">Thinking:</span> {s.thought}
        </p>
      ) : null}
      <ol className="divide-y divide-black/10">
        {s.feed.map((f, i) => (
          <li key={`${f.ts}-${i}`} className={`flex gap-2 py-1.5 text-xs ${f.verdict === "allowed" ? "" : "opacity-55"}`} title={f.reason || f.thought || undefined}>
            <span className="w-10 shrink-0 tabular-nums opacity-70">{f.ts.slice(11, 16)}</span>
            <span className="min-w-0 flex-1 break-words">{f.words}</span>
            <span className={`shrink-0 font-semibold ${f.verdict === "allowed" ? "text-[#1f7a3a]" : f.verdict === "failed" ? "text-[#b45309]" : "text-[#b42318]"}`}>
              {f.verdict === "allowed" ? "done" : f.verdict}
            </span>
          </li>
        ))}
        {!s.feed.length ? <li className="py-2 text-xs">No actions yet.</li> : null}
      </ol>
    </div>
  );
}

/** What the bot sees: its fresh screenshot, else the page text it is reading, else its last document or search. */
function Screen({ slug, s, last, error }: { slug: string; s: Shoulder | null; last: BotCard["last"]; error: string }) {
  if (s?.shot) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- a live file from the bot's workspace, not a build asset
      <img src={`/api/shoulder/shot?bot=${encodeURIComponent(slug)}&at=${encodeURIComponent(s.shot.at)}`} alt={`${slug}'s screen at ${s.shot.at.slice(11, 16)}`} className="w-full rounded-lg border border-line" />
    );
  }
  if (s?.page) {
    return (
      <article className="overflow-hidden rounded-lg border border-line bg-white text-[#1a1a1a]">
        <div className="flex items-center gap-2 border-b border-[#dfe3ea] bg-[#eef0f4] px-3 py-1.5 text-xs">
          <span className="h-2.5 w-2.5 rounded-full bg-[#d63b3b]" aria-hidden />
          <span className="truncate font-mono">{s.page.domain}</span>
          <a href={s.page.url} target="_blank" rel="noreferrer noopener" className="ml-auto shrink-0 underline">
            open
          </a>
        </div>
        <div className="mx-auto max-w-[44rem] px-4 py-3">
          {s.page.title ? <h3 className="mb-2 text-lg font-semibold">{s.page.title}</h3> : null}
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">{s.page.text || "(no text read on this page)"}</p>
        </div>
      </article>
    );
  }
  const sc = last?.screen;
  if (sc?.kind === "search") {
    return (
      <div className="rounded-lg bg-white p-6 text-[#1a1a1a]">
        <p className="mb-2 text-xs font-semibold text-[#5b6b9a]">search</p>
        <p className="rounded-md border-2 px-3 py-2 font-mono text-sm" style={{ borderColor: BRAND }}>
          {sc.title}
        </p>
      </div>
    );
  }
  if (sc?.kind === "doc" && last) {
    return (
      <div className="flex gap-4 rounded-lg bg-[#f4f1ea] p-6 text-[#1a1a1a]">
        <div className="h-20 w-16 shrink-0 rounded-sm bg-white shadow" aria-hidden />
        <div className="min-w-0">
          <p className="text-xs font-semibold text-[#7a6a52]">{last.words.split(" ")[0]}</p>
          <p className="mt-1 text-lg font-semibold break-words">{sc.title}</p>
        </div>
      </div>
    );
  }
  return <p className="p-6 text-sm text-muted">{error || (s ? "Nothing on the screen right now." : "Reading…")}</p>;
}
