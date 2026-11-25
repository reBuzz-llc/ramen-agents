"use client";
// A Settings form's result: a notice that is announced once (role="status"), can be dismissed, and
// leaves the address after the first render -- the ?msg= a form came back with is removed, so a refresh or a shared
// link does not show it again.
import { useEffect, useState } from "react";

export default function Notice({ msg }: { msg: string }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    // after the router's own first replaceState on a fresh load (it would put the address back), hence the short wait
    const t = setTimeout(() => {
      try {
        const u = new URL(window.location.href);
        if (u.searchParams.has("msg")) {
          u.searchParams.delete("msg");
          window.history.replaceState(null, "", `${u.pathname}${u.search}${u.hash}`);
        }
      } catch {
        /* leave the address as it is */
      }
    }, 300);
    return () => clearTimeout(t);
  }, []);
  if (!shown) return null;
  return (
    <div role="status" data-notice className="mt-4 flex items-start justify-between gap-3 rounded-xl border border-line border-l-4 border-l-accent bg-panel py-1 pr-1 pl-3 text-[0.9375rem] text-ink">
      <p className="py-2">{msg}</p>
      <button type="button" onClick={() => setShown(false)} aria-label="Dismiss" className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-xl text-muted hover:bg-bg">
        ×
      </button>
    </div>
  );
}
