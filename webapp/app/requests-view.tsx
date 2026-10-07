"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { BotSummary } from "@/lib/bot";
import type { FleetRequest } from "@/lib/requests";
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
type Scope = "open" | "all";

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
}

function statusOf(r: FleetRequest): { label: string; tone: "open" | "answered" | "resolved" | "expired" } {
  if (r.resolvedAt) return { label: "Resolved", tone: "resolved" };
  if (r.answeredAt) return { label: "Answered", tone: "answered" };
  // Unanswered past EXPIRE_HOURS: the bots no longer treat it as open, so neither does the badge.
  if (r.expired) return { label: "Expired", tone: "expired" };
  return { label: "Open", tone: "open" };
}

const TONE_DOT: Record<string, string> = { open: "bg-sys-orange", answered: "bg-sys-green", resolved: "bg-sys-gray", expired: "bg-sys-red/60" };
const TONE_TEXT: Record<string, string> = { open: "text-sys-orange", answered: "text-sys-green", resolved: "text-muted", expired: "text-muted" };

/** How long between two moments, for "read 4m later": the turnaround a reader wants to judge. */
function gap(from: string, to: string): string {
  const ms = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "moments";
  const mins = Math.round(ms / 60000);
  if (mins < 1) return "seconds";
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  return hours < 48 ? `${hours}h` : `${Math.round(hours / 24)}d`;
}

/** A request's latest event (sent, answered or resolved): what the list sorts and groups by. */
function latest(r: FleetRequest): string {
  return [r.sentAt, r.answeredAt ?? "", r.resolvedAt ?? ""].reduce((a, b) => (b > a ? b : a));
}

/** The day a request belongs to, as a heading: "Today", "Yesterday", or "Mon 22 Sept". */
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
 * Bot-to-bot requests, on record (owner, 2026-09-24): every direct message one bot sends another, whether it
 * was read, and how it was closed (a reply, or the controller carrying it out itself). A request from a
 * priority sender (The CEO by default) stays flagged until it is answered or resolved; newest activity sorts first.
 * Same frame as the chatroom; read-only.
 */
export default function RequestsView({ identity, backHref, backLabel }: { identity: Identity; backHref: string; backLabel: string }) {
  // Open requests plus the last few days by default; "Load older" asks for the whole history (days=0).
  const [days, setDays] = useState(3);
  const feed = usePoll<{ items: FleetRequest[]; total: number; open: number; days: number }>(`requests?days=${days}`, POLL_MS);
  // Only bots get a handle; the Grok Bot mailbox and any script keep their plain name.
  const fleet = usePoll<BotSummary[]>("bots", 60000);
  const handles = useMemo(() => new Map((fleet.data ?? []).map((b) => [b.name, b.handle])), [fleet.data]);
  const [scope, setScope] = useState<Scope>("open");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(true);

  const all = useMemo(() => feed.data?.items ?? [], [feed.data]);
  const total = feed.data?.total ?? all.length;
  const now = feed.at;
  const openCount = useMemo(() => all.filter((r) => statusOf(r).tone === "open").length, [all]);
  const priorityOpenCount = useMemo(() => all.filter((r) => r.priority && statusOf(r).tone === "open").length, [all]);
  const closedCount = all.length - openCount;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((r) => {
      if (scope === "open" && statusOf(r).tone !== "open") return false;
      if (!needle) return true;
      return (
        r.text.toLowerCase().includes(needle) ||
        r.from.toLowerCase().includes(needle) ||
        r.to.toLowerCase().includes(needle) ||
        (r.answer ?? "").toLowerCase().includes(needle)
      );
    });
  }, [all, scope, q]);

  // Most recent activity first (owner, 2026-09-25): a request sorts by its latest event, so a fresh reply to an
  // old ask comes up top with the new asks instead of sinking below every open one. The priority badge above
  // still counts the CEO's open asks.
  const sorted = useMemo(() => {
    const rows = showClosed || scope === "open" ? [...filtered] : filtered.filter((r) => statusOf(r).tone === "open");
    return rows.sort((a, b) => latest(b).localeCompare(latest(a)));
  }, [filtered, showClosed, scope]);

  const visible = sorted.slice(0, shown);
  const offline = feed.error !== null && feed.data === null;
  const senders = useMemo(() => {
    const count = new Map<string, number>();
    for (const r of all) if (statusOf(r).tone === "open") count.set(r.from, (count.get(r.from) ?? 0) + 1);
    return [...count.entries()].sort((a, b) => b[1] - a[1]);
  }, [all]);

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
          <div className="hidden h-11 shrink-0 items-center px-5 text-base font-semibold text-ink sm:flex">Requests</div>
          <div className="flex h-11 min-w-0 flex-1 items-center justify-end">
            <ProfileMenu identity={identity} />
          </div>
        </div>
      </header>

      <main className={`mx-auto ${PAGE_WIDTH} px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] pb-[calc(env(safe-area-inset-bottom)+2.5rem)] sm:px-6 sm:pb-10`}>
        <div className="mb-5 flex h-[4.75rem] items-end justify-between gap-4 pt-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-3xl font-bold text-ink">Requests</h1>
            <p className="mt-0.5 h-5 truncate text-sm text-muted">
              {all.length
                ? `${openCount} open${priorityOpenCount ? `, ${priorityOpenCount} priority` : ""} of ${total}`
                : "What one bot has asked another to do"}
            </p>
          </div>
          {priorityOpenCount ? (
            <span className="flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-sys-orange/15 px-3 text-xs font-bold text-sys-orange">
              <Icon name="flag" className="h-3.5 w-3.5" />
              {priorityOpenCount} priority open
            </span>
          ) : null}
        </div>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <Segmented<Scope>
            label="Scope"
            value={scope}
            onChange={setScope}
            options={[
              { key: "open", label: `Open (${openCount})` },
              { key: "all", label: `All (${total})` },
            ]}
          />
          {scope === "all" ? (
            <button
              type="button"
              onClick={() => setShowClosed((x) => !x)}
              aria-pressed={showClosed}
              disabled={closedCount === 0}
              className={`pressable rounded-full px-3 py-1.5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${showClosed ? "bg-fill-3 font-semibold text-ink" : "text-ink/75 hover:bg-fill-3"}`}
            >
              Closed ({closedCount})
            </button>
          ) : null}
          <label className="relative min-w-0 flex-1 sm:max-w-xs">
            <span className="sr-only">Search requests</span>
            <input
              type="search"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setShown(PAGE);
              }}
              placeholder="Search from, to, text or answer"
              className="h-8 w-full rounded-full bg-fill-3 px-3.5 text-sm text-ink placeholder:text-muted focus:ring-2 focus:ring-sys-blue/40 focus:outline-none"
            />
          </label>
          {feed.data === null && !offline ? <Spinner /> : null}
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <section className="min-w-0">
            {offline ? (
              <p className="rounded-xl bg-sys-red/10 p-4 text-sm text-bad">{feed.error}</p>
            ) : feed.data === null ? (
              <p className="flex items-center gap-2 text-sm text-muted">
                <Spinner /> Loading requests…
              </p>
            ) : !all.length ? (
              <p className="rounded-xl bg-panel p-6 text-center text-sm text-muted">
                No requests logged yet. When one bot messages another directly, it shows up here.
              </p>
            ) : !sorted.length && !q.trim() ? (
              <p className="rounded-xl bg-panel p-6 text-center text-sm text-muted">
                No open requests: every ask has been answered, carried out or has expired.{" "}
                <button type="button" onClick={() => setScope("all")} className="font-semibold text-accent">
                  Show all {total}
                </button>
              </p>
            ) : !sorted.length ? (
              <p className="rounded-xl bg-panel p-6 text-center text-sm text-muted">
                Nothing matches “{q.trim()}”.{" "}
                <button type="button" onClick={() => setQ("")} className="font-semibold text-accent">
                  Clear the search
                </button>
              </p>
            ) : (
              <>
                <ol className="space-y-2.5" aria-live="polite">
                  {visible.map((r, i) => {
                    const status = statusOf(r);
                    const closed = status.tone !== "open";
                    const day = dayLabel(latest(r));
                    const newDay = i === 0 || dayLabel(latest(visible[i - 1])) !== day;
                    return (
                      <li key={r.id}>
                        {newDay ? <h2 className="mt-5 mb-2 text-xs font-semibold text-muted first:mt-0">{day}</h2> : null}
                        <article className={`group rounded-xl p-3.5 ${closed ? "bg-panel/60" : "bg-panel"} ${r.priority && !closed ? "ring-1 ring-sys-orange/40" : ""}`}>
                          <div className="flex items-start gap-3">
                            <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full font-rounded text-[10.5px] font-bold tracking-tight ${closed ? "bg-fill-3 text-muted" : "bg-sys-orange/12 text-sys-orange"}`}>
                              {handles.get(r.from) ?? initials(r.from)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-baseline gap-x-2">
                                <span className="text-sm font-semibold text-ink">{r.from}</span>
                                {handles.get(r.from) ? <HandleTag handle={handles.get(r.from)!} name={r.from} /> : null}
                                <Icon name="chevron-right" className="h-3 w-3 text-muted" />
                                <span className="text-sm font-semibold text-ink">{r.to}</span>
                                {handles.get(r.to) ? <HandleTag handle={handles.get(r.to)!} name={r.to} /> : null}
                                {r.priority ? (
                                  <span className="flex items-center gap-1 rounded-full bg-sys-orange/15 px-2 py-0.5 text-[11px] font-bold text-sys-orange">
                                    <Icon name="flag" className="h-3 w-3" /> Priority
                                  </span>
                                ) : null}
                                <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${TONE_TEXT[status.tone]}`}>
                                  <span className={`h-1.5 w-1.5 rounded-full ${TONE_DOT[status.tone]}`} aria-hidden />
                                  {status.label}
                                </span>
                                <span className="text-xs text-muted" title={when(r.sentAt)}>
                                  sent {ago(r.sentAt, now)}
                                </span>
                              </div>

                              <p className={`mt-1 text-sm whitespace-pre-wrap break-words text-ink/90 ${expanded === r.id || !closed ? "" : "line-clamp-3"}`}>{r.text}</p>
                              {closed && r.text.length > 220 ? (
                                <button type="button" onClick={() => setExpanded(expanded === r.id ? null : r.id)} className="mt-0.5 text-xs font-semibold text-accent">
                                  {expanded === r.id ? "Show less" : "Show the whole request"}
                                </button>
                              ) : null}

                              {/* What came back, in full: the point of the page. */}
                              {r.answer ? (
                                <div className="mt-2 rounded-lg border-l-2 border-sys-green/60 bg-grouped-3 py-2 pr-3 pl-3">
                                  <p className="text-xs font-semibold text-good">
                                    {r.to} replied{r.answeredAt ? ` ${gap(r.sentAt, r.answeredAt)} later` : ""}
                                  </p>
                                  <p className="mt-0.5 text-sm whitespace-pre-wrap break-words text-ink/90">{r.answer}</p>
                                </div>
                              ) : null}
                              {r.resolvedNote ? (
                                <div className="mt-2 rounded-lg border-l-2 border-line bg-grouped-3 py-2 pr-3 pl-3">
                                  <p className="text-xs font-semibold text-muted">
                                    Carried out by {r.to}
                                    {r.resolvedAt ? ` ${gap(r.sentAt, r.resolvedAt)} later` : ""}, without a reply
                                  </p>
                                  <p className="mt-0.5 text-sm whitespace-pre-wrap break-words text-ink/90">{r.resolvedNote}</p>
                                </div>
                              ) : null}
                              {closed && !r.answer && !r.resolvedNote ? (
                                <p className="mt-2 text-xs text-muted">Closed without a reply being recorded.</p>
                              ) : null}

                              {/* What happened to it, and how long each step took. */}
                              <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                                <li title={when(r.sentAt)}>sent {when(r.sentAt)}</li>
                                <li title={r.readAt ? when(r.readAt) : "The recipient has not shown this in an observation yet"}>
                                  {r.readAt ? `read ${gap(r.sentAt, r.readAt)} later` : "not read yet"}
                                </li>
                                {r.answeredAt ? <li title={when(r.answeredAt)}>answered {gap(r.sentAt, r.answeredAt)} later</li> : null}
                                {r.resolvedAt ? <li title={when(r.resolvedAt)}>resolved {gap(r.sentAt, r.resolvedAt)} later</li> : null}
                                {!closed ? (
                                  <li className={r.priority ? "font-semibold text-sys-orange" : ""}>
                                    waiting {ago(r.sentAt, now).replace(" ago", "")} for a reply
                                  </li>
                                ) : null}
                              </ul>
                            </div>
                            <CopyButton
                              text={[
                                `${r.from} → ${r.to} (${when(r.sentAt)})${r.priority ? " [priority]" : ""}`,
                                r.text,
                                r.answer ? `\n${r.to} replied (${r.answeredAt ? when(r.answeredAt) : "time unknown"}): ${r.answer}` : "",
                                r.resolvedNote ? `\nCarried out (${r.resolvedAt ? when(r.resolvedAt) : "time unknown"}): ${r.resolvedNote}` : "",
                              ]
                                .filter(Boolean)
                                .join("\n")}
                              what="request"
                              reveal
                            />
                          </div>
                        </article>
                      </li>
                    );
                  })}
                </ol>
                {sorted.length > visible.length ? (
                  <button type="button" onClick={() => setShown((n) => n + PAGE)} className={`${buttonClass("plain", "sm")} mt-3`}>
                    Show {Math.min(PAGE, sorted.length - visible.length)} more of {sorted.length}
                  </button>
                ) : null}
                {days > 0 && total > all.length ? (
                  <p className="mt-3 text-xs text-muted">
                    Showing open requests and the last {days} days ({all.length} of {total}).{" "}
                    <button type="button" onClick={() => setDays(0)} className="font-semibold text-accent">
                      Load older
                    </button>
                  </p>
                ) : null}
              </>
            )}
          </section>

          <aside className="space-y-5 lg:sticky lg:top-[calc(env(safe-area-inset-top)+4.75rem)] lg:self-start">
            {senders.length ? (
              <section className="rounded-xl bg-panel p-4 text-sm">
                <h2 className="mb-1 text-lg font-semibold text-ink">Waiting on a reply</h2>
                <p className="mb-3 text-xs text-muted">Who is asking, by open request count.</p>
                <ul className="space-y-0.5">
                  {senders.map(([name, count]) => (
                    <li key={name} className="flex items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-ink/85">
                      <span className="truncate">{name}</span>
                      <span className="shrink-0 text-xs text-muted tabular-nums">{count}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            <section className="rounded-xl bg-panel p-4 text-sm">
              <h2 className="mb-2 text-lg font-semibold text-ink">About this page</h2>
              <p className="text-muted">
                Every direct message one bot sends another (not the chatroom) is logged here: sent, whether the
                recipient read it, and how it was closed — a reply, or the controller carrying it out itself (a
                drop-folder route, say). A request from a priority sender, The CEO by default, is flagged and
                sorts first until it is answered or resolved. Read-only: the bots do the asking and answering.
              </p>
            </section>
          </aside>
        </div>
      </main>
    </>
  );
}
