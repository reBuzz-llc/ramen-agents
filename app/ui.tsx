"use client";
// The app's few shared controls, so every form and button behaves the same way:
// - PendingButton: while its action waits on the server, a spinner and disabled (no second click);
// - Busy: a card that is waiting gets aria-busy and a light veil, so nothing else in it can be clicked meanwhile;
// - PendingForm: a plain form that does the same for itself on submit (Settings' forms post and come back);
// - Field: a label above its control, 4 px apart, every control 36 px high: one spacing for every form.
import { useState, type ButtonHTMLAttributes, type FormHTMLAttributes, type ReactNode } from "react";

import { labelText } from "@/lib/ui-classes";
export { control } from "@/lib/ui-classes";

const variants = {
  primary: "bg-accent text-on-accent font-semibold hover:bg-accent-hover",
  quiet: "border border-line bg-panel text-ink font-semibold hover:border-accent",
  danger: "border border-line bg-panel text-bad font-semibold hover:border-bad",
  link: "text-accent-ink hover:underline px-0",
} as const;

export function Spinner({ className = "" }: { className?: string }) {
  return <span aria-hidden className={`inline-block size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent align-[-2px] ${className}`} />;
}

type PendingProps = ButtonHTMLAttributes<HTMLButtonElement> & { pending?: boolean; variant?: keyof typeof variants; pendingLabel?: ReactNode };

export function PendingButton({ pending = false, variant = "primary", pendingLabel, className = "", children, disabled, ...rest }: PendingProps) {
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${className}`}
    >
      {pending ? <Spinner /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function Busy({ busy, children, className = "" }: { busy: boolean; children: ReactNode; className?: string }) {
  return (
    <div aria-busy={busy || undefined} className={`relative ${className}`}>
      {children}
      {busy ? <div aria-hidden className="absolute inset-0 cursor-progress rounded-[inherit] bg-panel/40" /> : null}
    </div>
  );
}

/** A form that posts and comes back (a full page load): a second submit is ignored and the form is veiled meanwhile. */
export function PendingForm({ children, className = "", ...rest }: FormHTMLAttributes<HTMLFormElement> & { children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  return (
    <form
      {...rest}
      aria-busy={busy || undefined}
      onSubmit={(e) => {
        if (busy) return e.preventDefault();
        rest.onSubmit?.(e);
        if (!e.defaultPrevented) setBusy(true);
      }}
      className={`relative ${className}`}
    >
      {children}
      {/* A veil, not disabled fields: a browser leaves disabled fields out of the form it is sending. */}
      {busy ? (
        <div className="absolute inset-0 flex cursor-progress items-start justify-end rounded-[inherit] bg-panel/40">
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <Spinner /> Saving…
          </span>
        </div>
      ) : null}
    </form>
  );
}

/** A label above its control. `span` sets the columns it takes in a 12-column grid (and 2 on a phone). */
export function Field({ label, children, className = "" }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`flex min-w-0 flex-col gap-1 ${className}`}>
      <span className={labelText}>{label}</span>
      {children}
    </label>
  );
}
