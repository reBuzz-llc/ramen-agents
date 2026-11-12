"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BotCard, Shoulder, WebData } from "@/lib/board";
import type { ChatLine } from "@/lib/owner-chat";
import { chatEmpty, chatRows, chatWait, webNote } from "@/lib/world";
import { markSeen } from "./chat-seen";
import { useVisibleInterval } from "./hooks";

const BRAND = "#ff6600";

// The member panel's Screen and Feed tabs (creatorCC queue 25, 2026-10-31: no pop-up anywhere): what the bot sees now
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

const MARK: Record<string, { label: string; color: string }> = {
  refused: { label: "refused", color: "#b42318" },
  captcha: { label: "captcha", color: "#b45309" },
  empty: { label: "empty", color: "#6b6b6b" },
};

/** Web (queue 33): the family's last 20 web actions, newest first, from /api/web (the world polls it every 12 s): who,
 *  when, the domain or "search:", the page title or the query, and a chip for refused, captcha and empty. A row with a
 *  domain opens that site in a new tab. Today's three counts on top. */
export function WebTab({ web }: { web: WebData | null }) {
  if (!web) return <p className="text-xs">Reading…</p>;
  const t = web.today;
  return (
    <div className="space-y-2 font-sans">
      <p className="pr-6 text-sm">
        <span className="font-semibold">Today:</span> {t.opens} page{t.opens === 1 ? "" : "s"} opened, {t.searches} search{t.searches === 1 ? "" : "es"}, {t.refused} refused
      </p>
      {web.events.length ? (
        <ol className="divide-y divide-black/10">
          {web.events.map((e, i) => {
            const mark = MARK[e.mark];
            const body = (
              <>
                <span className="w-24 shrink-0">
                  <span className="block truncate font-semibold">{e.name}</span>
                  <span className="block opacity-70">{e.ago}</span>
                </span>
                <span className="min-w-0 flex-1 break-words">
                  <span className="font-semibold">{e.kind === "search" ? "search:" : e.domain.replace(/^www\./, "") || "a page"}</span> {e.kind === "search" ? e.query : e.title}
                  {webNote(e) ? <span className="mt-0.5 block text-[11px] leading-snug opacity-60" data-web-note>{webNote(e)}</span> : null}
                </span>
                {mark ? (
                  <span className="shrink-0 self-start rounded px-1.5 py-0.5 font-semibold text-white" style={{ background: mark.color }}>
                    {mark.label}
                  </span>
                ) : null}
              </>
            );
            return (
              <li key={`${e.slug}-${e.ts}-${i}`} className={e.mark === "refused" ? "opacity-70" : ""}>
                {e.domain ? (
                  <a href={`https://${e.domain}`} target="_blank" rel="noopener noreferrer" className="flex gap-2 py-1.5 text-xs hover:bg-black/5" title={`Open ${e.domain} in a new tab`}>
                    {body}
                  </a>
                ) : (
                  <div className="flex gap-2 py-1.5 text-xs">{body}</div>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-xs">No web activity yet.</p>
      )}
    </div>
  );
}

/** Chat (queue 34): the owner's private conversation with this one agent, nothing else. The owner's lines on the right,
 *  the agent's on the left in its colour; polled every 2 s while the tab is open (queue 73: the engine's quick reply
 *  answers in seconds, so the tab must not be the wait). After a post, "<name> is typing…" shows until the reply lands
 *  or 20 s pass, then "still thinking, the reply comes here"; a new reply is scrolled into view. Enter posts,
 *  Shift+Enter is a new line (stored as a space). The post also lands in the bot's inbox. */
export function ChatTab({ slug, name }: { slug: string; name: string }) {
  const [chat, setChat] = useState<{ slug: string; lines: ChatLine[]; asleep: boolean; at: number } | null>(null);
  const [error, setError] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<string | null>(null); // the slug a post was just delivered to
  const list = useRef<HTMLOListElement>(null);
  const toBottom = useRef(true); // scroll to the newest line: on open and after a post, never on a mere poll
  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/chat/${encodeURIComponent(slug)}?limit=100`, { cache: "no-store" });
      const body = (await r.json()) as { lines?: ChatLine[]; asleep?: boolean; error?: string };
      if (r.ok) {
        setChat({ slug, lines: body.lines ?? [], asleep: !!body.asleep, at: Date.now() });
        setError("");
      } else setError(body.error ?? `HTTP ${r.status}`);
    } catch {
      setError("could not reach the dashboard");
    }
  }, [slug]);
  useEffect(() => {
    toBottom.current = true;
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);
  useVisibleInterval(() => void load(), 2000);
  // A reply arriving: scroll it into view (a poll that brings nothing new leaves the scroll where the owner put it).
  const count = useRef(0);
  useEffect(() => {
    if (chat?.slug !== slug) return;
    if (chat.lines.length > count.current && count.current > 0) toBottom.current = true;
    count.current = chat.lines.length;
  }, [chat, slug]);
  // the agent's replies count as seen once the tab shows the bottom of the chat (queue 35: clears the unread dots)
  const seeBottom = useCallback(() => {
    const el = list.current;
    const last = chat?.slug === slug ? [...chat.lines].reverse().find((l) => l.from !== "Owner") : undefined;
    if (last && (!el || el.scrollHeight - el.scrollTop - el.clientHeight < 8)) markSeen(slug, last.ts);
  }, [chat, slug]);
  useEffect(() => {
    const el = list.current;
    if (el && toBottom.current && chat?.slug === slug) {
      el.scrollTop = el.scrollHeight;
      toBottom.current = false;
    }
    seeBottom();
  }, [chat, slug, seeBottom]);
  async function post() {
    const t = text.replace(/\s*\n+\s*/g, " ").trim();
    if (!t || busy) return;
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/chat/${encodeURIComponent(slug)}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: t }) });
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setError(body.error ?? `could not send (${r.status})`);
      else {
        setText("");
        setSent(slug);
        toBottom.current = true;
        await load();
      }
    } catch {
      setError("could not reach the dashboard");
    } finally {
      setBusy(false);
    }
  }
  const mine = chat?.slug === slug ? chat : null;
  const rows = mine ? chatRows(mine.lines, slug, mine.at) : [];
  const wait = mine ? chatWait(mine.lines, mine.at) : null;
  return (
    <div className="flex flex-col gap-2 font-sans">
      {!mine ? (
        <p className="text-xs">{error || "Reading…"}</p>
      ) : rows.length ? (
        <ol ref={list} onScroll={seeBottom} className="max-h-80 space-y-1.5 overflow-y-auto pr-1">
          {rows.map((r, i) => (
            <li key={i} className={`flex ${r.side === "owner" ? "justify-end" : "justify-start"}`}>
              <div
                className={`max-w-[85%] rounded-lg px-2.5 py-1.5 text-xs break-words ${r.side === "owner" ? "bg-[#fff1e6]" : "bg-white"}`}
                style={r.side === "agent" ? { borderLeft: `4px solid ${r.color}`, boxShadow: "0 0 0 1px rgb(0 0 0 / 0.1)" } : undefined}
              >
                <span className="mb-0.5 block text-[10px] opacity-60">
                  {r.side === "owner" ? "You" : name} · {r.time}
                </span>
                {r.text}
              </div>
            </li>
          ))}
          {wait ? (
            <li className="flex justify-start" aria-live="polite">
              <div className="rounded-lg bg-white px-2.5 py-1.5 text-xs opacity-80" style={{ boxShadow: "0 0 0 1px rgb(0 0 0 / 0.1)" }}>
                {wait === "typing" ? (
                  <>
                    {name} is typing<span className="motion-safe:animate-pulse">…</span>
                  </>
                ) : (
                  `${name} is still thinking; the reply comes here.`
                )}
              </div>
            </li>
          ) : null}
        </ol>
      ) : (
        <p className="text-xs opacity-70">{chatEmpty(name)}</p>
      )}
      <div className="flex items-end gap-2">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void post();
            }
          }}
          rows={Math.min(4, Math.max(1, text.split("\n").length, Math.ceil(text.length / 38)))}
          maxLength={500}
          placeholder={`Write to ${name}`}
          aria-label={`Message to ${name}`}
          className="min-w-0 flex-1 resize-none rounded border-2 border-[#1a0d00] bg-white px-2 py-1 text-xs"
          disabled={busy}
        />
        <button type="button" onClick={() => void post()} disabled={busy || !text.trim()} className="rounded-md px-3 py-1.5 text-xs font-bold text-[#1a0d00] disabled:opacity-50" style={{ background: BRAND }}>
          Post
        </button>
      </div>
      {mine?.asleep ? <p className="text-xs opacity-70">Asleep: it will read it when started.</p> : null}
      {sent === slug && !error ? <p className="text-xs opacity-70">Delivered; {name} reads it on its next step.</p> : null}
      {error && mine ? <p className="text-xs text-[#b42318]">{error}</p> : null}
    </div>
  );
}
