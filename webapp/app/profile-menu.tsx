"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useVisibleInterval } from "./hooks";
import type { Identity } from "@/lib/identity";
import { ThemeSegmented } from "./theme-picker";
import { Icon } from "./ui";
import WorkPlanShortcut from "./work-plan-shortcut";

/** The profile button at the trailing end of the toolbar: who you are, appearance, and Settings. */
export default function ProfileMenu({ identity }: { identity: Identity }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [unread, setUnread] = useState(0);
  const [priorityOpen, setPriorityOpen] = useState(0);
  const [market, setMarket] = useState<string | null>(null); // the target market (target.toml), shown in the menu
  const loadCount = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts?count=1", { cache: "no-store" });
      if (res.ok) setUnread(((await res.json()) as { unread: number }).unread);
    } catch {
      /* keep the last count */
    }
  }, []);
  const loadRequests = useCallback(async () => {
    try {
      const res = await fetch("/api/requests?count=1", { cache: "no-store" });
      if (res.ok) setPriorityOpen(((await res.json()) as { open: number }).open);
    } catch {
      /* keep the last count */
    }
  }, []);
  useVisibleInterval(() => void loadCount(), 20000);
  useVisibleInterval(() => void loadRequests(), 20000);
  useEffect(() => {
    if (!open) return;
    let live = true;
    fetch("/api/target", { cache: "no-store" })
      .then((r) => r.json() as Promise<{ market?: string }>)
      .then((t) => live && setMarket(t.market || null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [open]);
  useEffect(() => {
    const again = () => void loadCount();
    window.addEventListener("alertschange", again);
    return () => window.removeEventListener("alertschange", again);
  }, [loadCount]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: PointerEvent) => root.current && !root.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    // The Work plan shortcut sits beside the profile button in every toolbar that has one.
    <div className="flex shrink-0 items-center gap-2">
      <WorkPlanShortcut />
      <div ref={root} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={
          priorityOpen
            ? `Profile and settings, ${priorityOpen} open priority request${priorityOpen === 1 ? "" : "s"}`
            : unread
              ? `Profile and settings, ${unread} unread notification${unread === 1 ? "" : "s"}`
              : "Profile and settings"
        }
        className="glass pressable relative grid h-11 w-11 place-items-center rounded-full"
      >
        {priorityOpen || unread ? (
          <span
            className={`absolute -top-0.5 -right-0.5 z-10 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[11px] font-bold text-white tabular-nums ring-2 ring-bg ${priorityOpen ? "bg-sys-orange" : "bg-sys-red"}`}
            aria-hidden
          >
            {(priorityOpen || unread) > 99 ? "99+" : priorityOpen || unread}
          </span>
        ) : null}
        <span className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-sys-gray to-[rgb(99_99_102)] font-rounded text-xs font-bold text-white">
          {identity.initials}
        </span>
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Profile"
          className="glass absolute top-full right-0 z-40 mt-2 w-[min(18.5rem,calc(100vw-1.5rem))] origin-top-right rounded-[1.375rem] p-1.5 [animation:menu-in_0.28s_var(--ease-spring)]"
        >
          <div className="flex items-center gap-3 px-2.5 pt-2 pb-2.5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gradient-to-br from-sys-gray to-[rgb(99_99_102)] font-rounded text-sm font-bold text-white">
              {identity.initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-ink">{identity.name}</span>
              <span className="block truncate text-xs text-muted">{identity.detail}</span>
            </span>
          </div>
          <div className="px-2.5 pb-2.5">
            <div className="mb-1.5 text-xs font-semibold text-muted">Appearance</div>
            <ThemeSegmented />
          </div>
          <div className="border-t border-line pt-1.5">
            <Link
              href="/chatroom"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-[0.875rem] px-2.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-fill-3"
            >
              <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-sys-indigo text-white">
                <Icon name="chat" className="h-4 w-4" />
              </span>
              <span className="flex-1">Bot chatroom</span>
              <Icon name="chevron-right" className="h-3.5 w-3.5 text-muted" />
            </Link>
            <Link
              href="/work-plan#target"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-[0.875rem] px-2.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-fill-3"
            >
              <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-sys-teal text-white">
                <Icon name="flag" className="h-4 w-4" />
              </span>
              <span className="flex-1">Target market</span>
              <span className="max-w-[9rem] truncate text-xs text-muted">{market ?? "…"}</span>
              <Icon name="chevron-right" className="h-3.5 w-3.5 text-muted" />
            </Link>
            <Link
              href="/work-plan"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-[0.875rem] px-2.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-fill-3"
            >
              <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-sys-green text-white">
                <Icon name="check" className="h-4 w-4" />
              </span>
              <span className="flex-1">Work plan</span>
              <Icon name="chevron-right" className="h-3.5 w-3.5 text-muted" />
            </Link>
            <Link
              href="/family-review"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-[0.875rem] px-2.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-fill-3"
            >
              <span className="grid h-7 w-7 place-items-center rounded-[8px] text-[#1a0d00]" style={{ background: "#ff6600" }}>
                <Icon name="check" className="h-4 w-4" />
              </span>
              <span className="flex-1">Family review</span>
              <Icon name="chevron-right" className="h-3.5 w-3.5 text-muted" />
            </Link>
            <Link
              href="/requests"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-[0.875rem] px-2.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-fill-3"
            >
              <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-sys-orange text-white">
                <Icon name="flag" className="h-4 w-4" />
              </span>
              <span className="flex-1">Requests</span>
              {priorityOpen ? <span className="rounded-full bg-sys-orange px-2 py-0.5 text-xs font-bold text-white tabular-nums">{priorityOpen}</span> : null}
              <Icon name="chevron-right" className="h-3.5 w-3.5 text-muted" />
            </Link>
            <Link
              href="/settings/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-[0.875rem] px-2.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-fill-3"
            >
              <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-sys-red text-white">
                <Icon name="bell" className="h-4 w-4" />
              </span>
              <span className="flex-1">Notifications</span>
              {unread ? <span className="rounded-full bg-sys-red px-2 py-0.5 text-xs font-bold text-white tabular-nums">{unread}</span> : null}
              <Icon name="chevron-right" className="h-3.5 w-3.5 text-muted" />
            </Link>
            <Link
              href="/settings"
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-[0.875rem] px-2.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-fill-3"
            >
              <span className="grid h-7 w-7 place-items-center rounded-[8px] bg-sys-gray text-white">
                <Icon name="gear" className="h-4 w-4" />
              </span>
              <span className="flex-1">Settings</span>
              <Icon name="chevron-right" className="h-3.5 w-3.5 text-muted" />
            </Link>
          </div>
        </div>
      ) : null}
      </div>
    </div>
  );
}
