"use client";

import { Spinner } from "./ui";

import { useEffect, useState } from "react";

/** Put text on the clipboard. The async Clipboard API only exists in secure contexts (https or localhost);
 * over the plain-http Tailscale address it is missing, so fall back to a hidden textarea and execCommand,
 * which Safari on iOS also accepts inside a tap. */
export async function copyText(text: string): Promise<boolean> {
  if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      /* permission denied or not focused: try the fallback */
    }
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  Object.assign(area.style, { position: "fixed", top: "-1000px", left: "0", opacity: "0", fontSize: "16px" });
  document.body.appendChild(area);
  area.select();
  area.setSelectionRange(0, text.length);
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

type Props = {
  /** The text to copy, or a function that builds it at click time (it may fetch; prefer text already loaded,
   * because iOS Safari only lets a tap copy synchronously). */
  text: string | (() => string | Promise<string>);
  /** What is copied, for the tooltip and screen readers: "question", "page address". */
  what: string;
  /** Hidden until the surrounding `group` is hovered or focused (always shown on touch screens). */
  reveal?: boolean;
  /** Tone for use on a coloured background, such as the owner's chat bubbles. */
  onAccent?: boolean;
  className?: string;
};

export default function CopyButton({ text, what, reveal = false, onAccent = false, className = "" }: Props) {
  const [state, setState] = useState<"idle" | "working" | "done" | "failed">("idle");

  useEffect(() => {
    if (state === "idle" || state === "working") return;
    const t = setTimeout(() => setState("idle"), 1600);
    return () => clearTimeout(t);
  }, [state]);

  const label = state === "done" ? "Copied" : state === "failed" ? "Copy failed" : state === "working" ? `Copying ${what}…` : `Copy ${what}`;
  const tone =
    state === "done"
      ? "text-good"
      : state === "failed"
        ? "text-bad"
        : onAccent
          ? "text-white/80 hover:text-white hover:bg-white/15"
          : "text-muted hover:text-ink hover:bg-fill-3";
  const visibility = reveal
    ? "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100"
    : "";

  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={async (e) => {
        e.stopPropagation();
        if (state === "working") return;
        let value = typeof text === "function" ? text() : text;
        if (typeof value !== "string") {
          setState("working");
          try {
            value = await value;
          } catch {
            setState("failed");
            return;
          }
        }
        setState((await copyText(value)) ? "done" : "failed");
      }}
      className={`hit pressable inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none ${
        state !== "idle" ? "opacity-100" : visibility
      } ${tone} ${className}`}
    >
      {state === "working" ? (
        <Spinner small />
      ) : state === "done" ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <path d="m3.5 8.5 3 3 6-7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" aria-hidden>
          <rect x="5.25" y="5.25" width="8" height="8" rx="1.75" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <path d="M10.75 3.5V3.25A1.75 1.75 0 0 0 9 1.5H4.25A1.75 1.75 0 0 0 2.5 3.25V9a1.75 1.75 0 0 0 1.75 1.75h.25" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      )}
      <span className="sr-only" aria-live="polite">
        {state === "done" ? "Copied" : ""}
      </span>
    </button>
  );
}
