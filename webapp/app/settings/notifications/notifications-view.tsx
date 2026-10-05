"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { AlertsView } from "@/lib/alerts";
import type { BotSummary } from "@/lib/bot";
import { sendJson } from "@/lib/client";
import { ago } from "@/lib/format";
import HandleTag from "../../handle-tag";
import { useNow, usePoll, useVisibleInterval } from "../../hooks";
import { buttonClass, Icon, Panel, Spinner, Toggle } from "../../ui";

type IconName = Parameters<typeof Icon>[0]["name"];

export default function NotificationsView() {
  const [view, setView] = useState<AlertsView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null); // what the test send came back with
  const [failed, setFailed] = useState<string | null>(null); // the last change that did not go through
  const [showMuted, setShowMuted] = useState(false);
  const now = useNow(15000);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts", { cache: "no-store" });
      if (res.ok) setView((await res.json()) as AlertsView);
    } catch {
      /* keep the last view */
    }
  }, []);
  useVisibleInterval(() => void load(), 15000);
  const fleet = usePoll<BotSummary[]>("bots", 60000);
  const handles = new Map((fleet.data ?? []).map((b) => [b.name, b.handle]));

  const post = async (payload: Record<string, unknown>): Promise<boolean> => {
    const sent = await sendJson<AlertsView & { ok?: boolean; error?: string }>("/api/alerts", "POST", payload);
    if (sent.ok && sent.body) setView(sent.body);
    setFailed(sent.ok ? null : `That did not go through: ${sent.body?.error ?? sent.error ?? "request failed"}`);
    window.dispatchEvent(new Event("alertschange"));
    return sent.ok;
  };

  // Opening the list counts as reading it, as on iOS; unread rows stay highlighted while you look.
  const [unreadIds, setUnreadIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!view || !view.unread) return;
    const t = setTimeout(() => {
      setUnreadIds(new Set(view.alerts.filter((a) => !a.read).map((a) => a.id)));
      void post({ op: "read-all" });
    }, 1200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mark read once per new unread batch
  }, [view?.unread]);

  if (!view) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <Spinner /> Loading…
      </p>
    );
  }
  const types = new Map(view.types.map((t) => [t.key, t]));
  // An alert of a type you switched off is muted: kept, but out of the way until you ask for it.
  const muted = view.alerts.filter((a) => !types.get(a.type)?.notify);
  // Notion refusing writes blocks every board at once: the newest such alert of the last day stays pinned on top.
  // The newest Notion alert decides: an all-clear ("Notion is writable again") after a failure takes the banner down.
  const lastNotion = view.alerts.find((a) => a.type === "notion");
  const notionDown =
    lastNotion && !lastNotion.title.startsWith("Notion is writable again") && now > 0 && now - new Date(lastNotion.at).getTime() < 24 * 3600e3 ? lastNotion : undefined;
  const listed = showMuted ? view.alerts : view.alerts.filter((a) => types.get(a.type)?.notify);

  return (
    <>
      {notionDown ? (
        <div role="alert" className="mb-4 flex gap-3 rounded-xl bg-sys-red/12 p-4 ring-1 ring-sys-red/30">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] bg-sys-red text-white">
            <Icon name="flag" className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-bad">{notionDown.title}</p>
            <p className="mt-0.5 text-sm break-words text-ink/85">{notionDown.body}</p>
            <p className="mt-1 text-xs text-muted">First seen {ago(notionDown.at, now)} from {notionDown.botName}. Leads, tasks and packages wait until this is fixed.</p>
          </div>
        </div>
      ) : null}
      {failed ? (
        <p role="alert" className="mb-3 rounded-lg bg-sys-red/10 px-3 py-2 text-sm text-bad">
          {failed}
        </p>
      ) : null}
      <Panel
        title="Recent"
        aside={view.alerts.length ? <button type="button" onClick={() => window.confirm("Clear every alert in the list?") && void post({ op: "clear" })} className="hit text-xs font-semibold text-accent">Clear all</button> : undefined}
      >
        {muted.length ? (
          <p className="mb-2 text-xs text-muted">
            {muted.length} alert{muted.length === 1 ? "" : "s"} of a kind you switched off{" "}
            <button type="button" onClick={() => setShowMuted((v) => !v)} className="font-semibold text-accent">
              {showMuted ? "hide them" : "show them"}
            </button>
          </p>
        ) : null}
        {listed.length ? (
          <ul className="divide-y divide-line">
            {listed.map((a) => {
              const t = types.get(a.type);
              const fresh = !a.read || unreadIds.has(a.id);
              const inner = (
                <div className="flex gap-3 py-3">
                  <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-[10px] text-white ${t?.tile ?? "bg-sys-gray"}`}>
                    <Icon name={(t?.icon ?? "bell") as IconName} className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-ink">
                        {fresh ? <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-sys-blue align-middle" role="img" aria-label="unread" /> : null}
                        {a.botName}
                        {handles.get(a.botName) ? <HandleTag handle={handles.get(a.botName)!} name={a.botName} className="ml-1.5 align-middle" /> : null}
                      </span>
                      <span className="shrink-0 text-xs text-muted">{ago(a.at, now)}</span>
                    </div>
                    <p className="text-sm text-ink">{a.title}</p>
                    {a.body ? <p className="mt-0.5 line-clamp-2 text-sm text-muted">{a.body}</p> : null}
                  </div>
                </div>
              );
              return (
                <li key={a.id}>
                  {a.href ? (
                    a.href.startsWith("/") ? (
                      <Link href={a.href} className="-mx-2 block rounded-lg px-2 hover:bg-fill-3">
                        {inner}
                      </Link>
                    ) : (
                      <a href={a.href} target="_blank" rel="noreferrer" className="-mx-2 block rounded-lg px-2 hover:bg-fill-3">
                        {inner}
                      </a>
                    )
                  ) : (
                    inner
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-muted">
            {view.alerts.length
              ? "Nothing to show: every alert here is of a kind you switched off."
              : "No alerts yet. When a bot creates a task, finds a provider, writes to you, or needs attention, it shows up here."}
          </p>
        )}
      </Panel>

      <Panel title="Notify on this Mac" hint="Switch on what you want to be told about: those alerts pop up in Notification Center and appear in the list above. The rest are still recorded, but stay out of the list unless you ask for them.">
        <ul className="divide-y divide-line">
          {view.types.map((t) => (
            <li key={t.key} className="flex items-center gap-3 py-2.5">
              <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-[8px] text-white ${t.tile}`}>
                <Icon name={t.icon as IconName} className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink">{t.label}</span>
                <span className="block text-xs text-muted">{t.detail}</span>
              </span>
              <Toggle
                on={t.notify}
                label={`Notify for ${t.label}`}
                disabled={busy === t.key}
                onChange={async (on) => {
                  setBusy(t.key);
                  await post({ op: "notify", type: t.key, on });
                  setBusy(null);
                }}
              />
            </li>
          ))}
        </ul>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              const ok = await post({ op: "test" });
              setTested(ok ? "Sent. If nothing appeared, allow notifications for Script Editor in System Settings > Notifications." : "The test notification could not be sent.");
            }}
            className={buttonClass("tinted", "sm")}
          >
            Send a test notification
          </button>
          {tested ? <span className="text-xs text-muted">{tested}</span> : null}
        </div>
      </Panel>
    </>
  );
}
