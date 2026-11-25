"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** An owner or manager enters the real end of a member's clock. The box starts empty: there is no default time. */
export default function ClockFix({ shiftId, action, label }: { shiftId: string; action: "close" | "correct"; label: string }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const send = async () => {
    const at = new Date(value);
    if (!value || Number.isNaN(at.getTime())) return setError("Give the date and time the work really ended.");
    setBusy(true);
    setError("");
    const r = (await fetch(`/api/shifts/${shiftId}/close`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, at: at.toISOString() }) }).then((x) => x.json()).catch(() => ({ ok: false, error: "No answer from the server." }))) as { ok: boolean; error?: string };
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "That failed.");
    setValue("");
    router.refresh();
  };
  return (
    <div data-clock-fix={action} className="mt-2 flex flex-wrap items-end gap-2">
      <label className="block text-xs text-muted">
        When the work really ended
        <input type="datetime-local" value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 block min-h-11 rounded-lg border border-line bg-bg px-2 text-sm text-ink" />
      </label>
      <button type="button" disabled={busy || !value} onClick={() => void send()} className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50">
        {label}
      </button>
      {error ? <p role="alert" className="w-full text-xs text-bad">{error}</p> : null}
    </div>
  );
}
