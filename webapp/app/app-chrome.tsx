"use client";

import { createPortal } from "react-dom";
import type { BotProfile } from "@/lib/bot";
import { PAGE_WIDTH, useActionsSlot, type Section } from "./chrome-shell";

export type { Section };

const NBSP = " ";

/**
 * One page's part of the app frame: its large title, its toolbar actions, and its content. The toolbar and
 * tab bar themselves live in ChromeShell (app/bots/[slug]/layout.tsx) and stay mounted across pages.
 * The title block is exactly one title and one line on every page and screen size (nothing wraps), so
 * switching pages never moves the content.
 */
export default function AppChrome({
  title,
  subtitle,
  status,
  statusLine,
  actions,
  children,
}: {
  bot?: BotProfile;
  section?: Section;
  title: string;
  subtitle?: React.ReactNode;
  /** A status pill shown beside the title on wide screens. */
  status?: React.ReactNode;
  /** What phones show in the subtitle line instead of the subtitle, such as a one-line status. */
  statusLine?: React.ReactNode;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const slot = useActionsSlot();
  return (
    <>
      {slot && actions ? createPortal(actions, slot) : null}
      <main className={`mx-auto ${PAGE_WIDTH} px-4 pt-[calc(env(safe-area-inset-top)+4.5rem)] pb-[calc(env(safe-area-inset-bottom)+6.5rem)] sm:px-6 sm:pb-10`}>
        <div className="mb-5 flex h-[4.75rem] items-end justify-between gap-4 pt-2">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-3xl font-bold text-ink">{title}</h1>
            <p className={`mt-0.5 h-5 truncate text-sm text-muted ${statusLine ? "hidden sm:block" : ""}`}>{subtitle ?? NBSP}</p>
            {statusLine ? <p className="mt-0.5 flex h-5 min-w-0 items-center gap-2 text-sm whitespace-nowrap sm:hidden">{statusLine}</p> : null}
          </div>
          {status ? <div className="hidden shrink-0 sm:block">{status}</div> : null}
        </div>
        {children}
      </main>
    </>
  );
}
