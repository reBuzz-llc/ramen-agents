"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";

/** "Seen" at the end of a health banner line (queue 54): hides the line until its fact changes. A 32 px tap target
 *  under 1024 px. */
export default function SeenButton({ id, text }: { id: string; text: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function seen() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/health-seen", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, text }) });
      if (res.ok) router.refresh();
      else setError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `could not save (${res.status})`);
    } catch {
      setError("could not reach the dashboard");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="shrink-0">
      <button type="button" onClick={() => void seen()} disabled={busy} className="min-h-8 min-w-12 rounded-md border border-bad/40 bg-white/60 px-2 text-xs font-semibold text-bad disabled:opacity-50 lg:min-h-0 lg:py-0.5" title="Hide this until it changes">
        {busy ? "…" : "Seen"}
      </button>
      {error ? <span className="ml-1 text-xs">{error}</span> : null}
    </span>
  );
}
