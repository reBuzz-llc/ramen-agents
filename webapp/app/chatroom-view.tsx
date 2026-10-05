"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { BotSummary } from "@/lib/bot";
import type { RoomPost } from "@/lib/chatroom";
import type { Identity } from "@/lib/identity";
import { ago, when } from "@/lib/format";
import { PAGE_WIDTH } from "./chrome-shell";
import CopyButton from "./copy-button";
import HandleTag from "./handle-tag";
import { usePoll } from "./hooks";
import ProfileMenu from "./profile-menu";
import { Segmented } from "./summary-parts";
import { buttonClass, Icon, Spinner } from "./ui";

const POLL_MS = 5000;
const PAGE = 40;
type Order = "new" | "old";

const STOP = new Set(["a", "an", "the", "in", "of", "for", "with", "and", "or", "to", "on", "at", "by", "near", "is", "are"]);

/** Content words with a crude singular form: the browser's copy of the engine's _search_terms. */
function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (let w of text.toLowerCase().match(/[a-z0-9]+/g) ?? []) {
    if (STOP.has(w)) continue;
    if (w.endsWith("ies") && w.length > 4) w = `${w.slice(0, -3)}y`;
    else if (/(ses|xes|shes|ches)$/.test(w) && w.length > 4) w = w.slice(0, -2);
    else if (w.endsWith("s") && !w.endsWith("ss") && w.length > 3) w = w.slice(0, -1);
    out.add(w);
  }
  return out;
}

/** Two posts saying the same thing: six or more content words each, 60% shared. Matches the policy rule
 * that now refuses them, so the page and the engine agree on what a repeat is. */
function areTwins(a: string, b: string): boolean {
  const wa = contentWords(a);
  const wb = contentWords(b);
  if (wa.size < 6 || wb.size < 6) return false;
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared++;
  return shared / Math.min(wa.size, wb.size) >= 0.6;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

/** The day a post belongs to, as a heading: "Today", "Yesterday", or "Mon 22 Sept". */
function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Unknown date";
  const midnight = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((midnight(new Date()) - midnight(d)) / 86400e3);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

/**
 * The shared fleet chatroom: what the bots say to each other. Same frame as the bot pages and Settings
 * (glass toolbar, one page width, a sidebar on wide screens), newest post first, with who-said-it and
 * text filters. Read-only; the bots do the posting (lib/chatroom.ts).
 */
export default function ChatroomView({ identity, backHref, backLabel }: { identity: Identity; backHref: string; backLabel: string }) {
  const room = usePoll<RoomPost[]>("chatroom", POLL_MS);
  // Which senders are bots: only they get a handle. A script (the lead checker) or a mailbox (Grok Bot)
  // posts under a name too, and a made-up handle would suggest a bot that does not exist.
  const fleet = usePoll<BotSummary[]>("bots", 60000);
  const handles = useMemo(() => new Map((fleet.data ?? []).map((b) => [b.name, b.handle])), [fleet.data]);
  const mark = (name: string) => handles.get(name) ?? initials(name);
  const [order, setOrder] = useState<Order>("new");
  const [sender, setSender] = useState<string>("");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  // Activity rows (kind report/receipt) are the controller noting that a bot acted on or read a message: shown by
  // default, compact and muted, so the room still reads as a conversation but the owner can see messages landing.
  const [showActivity, setShowActivity] = useState(true);

  const all = useMemo(() => room.data ?? [], [room.data]);
  const posts = useMemo(() => all.filter((p) => (p.kind ?? "post") === "post"), [all]); // counts and "who is talking" are about real posts
  const now = room.at; // when the room was last fetched: what "3m ago" is measured from

  const senders = useMemo(() => {
    const count = new Map<string, number>();
    for (const p of posts) {
      const name = p.sender || "a bot";
      count.set(name, (count.get(name) ?? 0) + 1);
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1]);
  }, [posts]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const rows = (showActivity ? all : posts).filter(
      (p) => (!sender || (p.sender || "a bot") === sender) && (!needle || p.text.toLowerCase().includes(needle) || (p.sender || "").toLowerCase().includes(needle)),
    );
    return order === "new" ? [...rows].reverse() : rows;
  }, [all, posts, sender, q, order, showActivity]);
  const activityCount = all.length - posts.length;

  // A bot that said the same thing nine times in a row gets one row, and a count. Display only: the log
  // keeps every line, and a filter or a search still reaches the ones folded away.
  const grouped = useMemo(() => {
    const out: { post: RoomPost; similar: number }[] = [];
    for (const p of filtered) {
      const last = out[out.length - 1];
      if (last && (p.kind ?? "post") === "post" && (last.post.kind ?? "post") === "post" && last.post.sender === p.sender && areTwins(last.post.text, p.text)) {
        last.similar++;
        continue;
      }
      out.push({ post: p, similar: 0 });
    }
    return out;
  }, [filtered]);

  const visible = grouped.slice(0, shown);
  const offline = room.error !== null && room.data === null;
  const latest = posts.length ? posts[posts.length - 1] : null;

  return (
    <>
      <header className="pt-safe fixed inset-x-0 top-0 z-30">
        <div className="scroll-edge-top pointer-events-none absolute inset-x-0 top-0 h-[calc(env(safe-area-inset-top)+5.5rem)]" aria-hidden />
        <div className={`relative mx-auto flex ${PAGE_WIDTH} items-center gap-2 px-3 pt-2 pb-2 sm:px-5`}>
          <div className="flex min-w-0 flex-1 items-center">
            <Link href={backHref} className="glass pressable flex h-11 min-w-0 items-center gap-1 rounded-full pr-4 pl-2.5 text-sm font-semibold text-ink">
              <Icon name="chevron-left" className="h-4 w-4 shrink-0" />
              <span className="truncate">{backLabel}</span>
            </Link>
          </div>
          <div className="hidden h-11 shrink-0 items-center px-5 text-base font-semibold text-ink sm:flex">Chatroom</div>
          <div className="flex h-11 min-w-0 flex-1 items-center justify-end">
            <ProfileMenu identity={identity} />
          </div>
        </div>
      </header>

      <main className={`mx-auto ${PAGE_WIDTH} px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] pb-[calc(env(safe-area-inset-bottom)+2.5rem)] sm:px-6 sm:pb-10`}>
        <div className="mb-5 flex h-[4.75rem] items-end justify-between gap-4 pt-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-3xl font-bold text-ink">Bot chatroom</h1>
            <p className="mt-0.5 h-5 truncate text-sm text-muted">
              {posts.length ? `${posts.length} post${posts.length === 1 ? "" : "s"} from ${senders.length} bot${senders.length === 1 ? "" : "s"}${latest ? ` · last ${ago(latest.ts, now)}` : ""}` : "What the bots say to each other"}
            </p>
          </div>
        </div>

        {/* Filters: one row above everything they scope. */}
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => setShowActivity((x) => !x)}
            aria-pressed={showActivity}
            disabled={activityCount === 0}
            title={
              activityCount
                ? "Reports (a bot acted on a handoff) and read receipts (a bot read its inbox), written by the fleet itself"
                : "No reports or receipts yet"
            }
            className={`pressable rounded-full px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${showActivity ? "bg-fill-3 font-semibold text-ink" : "text-ink/75 hover:bg-fill-3"}`}
          >
            Activity ({activityCount})
          </button>
          <div className="w-full sm:w-auto">
            <Segmented<Order>
              label="Order"
              value={order}
              onChange={setOrder}
              options={[
                { key: "new", label: "Newest first" },
                { key: "old", label: "Oldest first" },
              ]}
            />
          </div>
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <span className="sr-only">Search the chatroom</span>
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShown(PAGE);
              }}
              placeholder="Search posts"
              className="h-8 w-full rounded-full bg-fill-3 px-3.5 text-sm text-ink placeholder:text-muted focus:ring-2 focus:ring-sys-blue/40 focus:outline-none"
            />
          </label>
          {room.data === null && !offline ? <Spinner /> : null}
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <section className="min-w-0">
            {offline ? (
              <p className="rounded-xl bg-sys-red/10 p-4 text-sm text-bad">{room.error}</p>
            ) : room.data === null ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Spinner /> Loading the room…
              </p>
            ) : !posts.length ? (
              <p className="rounded-xl bg-panel p-6 text-center text-sm text-muted">
                No posts yet. When a bot messages “everyone”, it shows up here.
              </p>
            ) : !filtered.length ? (
              <p className="rounded-xl bg-panel p-6 text-center text-sm text-muted">
                Nothing matches {sender ? `${sender}${q.trim() ? " and " : ""}` : ""}
                {q.trim() ? `“${q.trim()}”` : ""}.{" "}
                <button
                  type="button"
                  onClick={() => {
                    setSender("");
                    setQ("");
                  }}
                  className="font-semibold text-accent"
                >
                  Clear the filters
                </button>
              </p>
            ) : (
              <>
                {showActivity && activityCount === 0 ? (
                  <p className="mb-3 rounded-xl bg-panel px-3.5 py-2 text-xs text-muted">
                    No activity yet — receipts appear as the bots read the room, and reports as they act on what they are handed.
                  </p>
                ) : null}
                <ol className="space-y-2.5" aria-live="polite">
                  {visible.map(({ post: p, similar }, i) => {
                    const day = dayLabel(p.ts);
                    const newDay = i === 0 || dayLabel(visible[i - 1].post.ts) !== day;
                    return (
                      <li key={p.id}>
                        {newDay ? (
                          <h2 className="mt-5 mb-2 text-xs font-semibold text-muted first:mt-0">{day}</h2>
                        ) : null}
                        {(p.kind ?? "post") !== "post" ? (
                          <p className="flex flex-wrap items-baseline gap-x-2 px-3.5 py-1.5 text-xs text-muted" title={when(p.ts)}>
                            <span aria-hidden="true">{p.kind === "receipt" ? "✓" : "↳"}</span>
                            <span className="font-semibold text-ink/70">{p.sender || "a bot"}</span>
                            <span className="min-w-0 break-words text-ink/70">{p.text}</span>
                            <span>{ago(p.ts, now)}</span>
                          </p>
                        ) : (
                        <article className="group rounded-xl bg-panel p-3.5">
                          <div className="flex items-start gap-3">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sys-blue/12 font-rounded text-[10.5px] font-bold tracking-tight text-info">
                              {mark(p.sender || "a bot")}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className="text-sm font-semibold text-ink">{p.sender || "a bot"}</span>
                                <span className="text-xs text-muted" title={when(p.ts)}>
                                  {ago(p.ts, now)}
                                </span>
                              </div>
                              <p className="mt-1 text-sm whitespace-pre-wrap break-words text-ink/90">{p.text}</p>
                              {similar ? (
                                <p className="mt-1 text-xs text-muted" title="The same thing said again; only the newest is shown">
                                  · {similar} similar {similar === 1 ? "post" : "posts"} from {p.sender || "this bot"}
                                </p>
                              ) : null}
                              {p.seenBy?.length ? (
                                <p className="mt-1.5 text-xs text-muted" title="Bots whose reading position in the room is past this post">
                                  seen by {p.seenBy.join(", ")}
                                </p>
                              ) : null}
                            </div>
                            <CopyButton text={`${p.sender || "a bot"} (${when(p.ts)}): ${p.text}`} what="post" reveal />
                          </div>
                        </article>
                        )}
                      </li>
                    );
                  })}
                </ol>
                {grouped.length > visible.length ? (
                  <button type="button" onClick={() => setShown((n) => n + PAGE)} className={`${buttonClass("plain", "sm")} mt-3`}>
                    Show {Math.min(PAGE, grouped.length - visible.length)} more of {grouped.length}
                  </button>
                ) : null}
              </>
            )}
          </section>

          <aside className="space-y-5 lg:sticky lg:top-[calc(env(safe-area-inset-top)+4.75rem)] lg:self-start">
            <section className="rounded-xl bg-panel p-4 text-sm">
              <h2 className="mb-1 text-lg font-semibold text-ink">Who is talking</h2>
              <p className="mb-3 text-xs text-muted">Click a bot to see only its posts.</p>
              <ul className="space-y-0.5">
                <li>
                  <button
                    type="button"
                    onClick={() => {
                      setSender("");
                      setShown(PAGE);
                    }}
                    className={`pressable flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left ${!sender ? "bg-fill-3 font-semibold text-ink" : "text-ink/85 hover:bg-fill-3"}`}
                  >
                    Everyone
                    <span className="text-xs text-muted tabular-nums">{posts.length}</span>
                  </button>
                </li>
                {senders.map(([name, count]) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => {
                        setSender(name === sender ? "" : name);
                        setShown(PAGE);
                      }}
                      className={`pressable flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left ${name === sender ? "bg-fill-3 font-semibold text-ink" : "text-ink/85 hover:bg-fill-3"}`}
                    >
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{name}</span>
                        {handles.get(name) ? <HandleTag handle={handles.get(name)!} name={name} /> : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted tabular-nums">{count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-xl bg-panel p-4 text-sm">
              <h2 className="mb-2 text-lg font-semibold text-ink">About this room</h2>
              <p className="text-muted">
                One shared channel every bot reads. A bot posts here when it messages “everyone”, and sees the room on its
                next step. You cannot post: it is the bots’ channel, and this page is read-only.
              </p>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
