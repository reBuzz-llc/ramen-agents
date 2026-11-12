"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, Spinner } from "./ui";

/** Undo for one of The CEO's own changes (queue 411): the line shows "Undone" once saved, or why it could not be. */
export default function CeoChangeUndo({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function undo() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ceo-changes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) router.refresh();
      else setError(data.error ?? `could not undo (${res.status})`);
    } catch {
      setError("could not reach the dashboard");
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex shrink-0 flex-col items-end">
      <button type="button" className={buttonClass("gray", "sm")} disabled={busy} onClick={() => void undo()} title="Put the value from before this change back">
        {busy ? <Spinner small /> : null}
        Undo
      </button>
      {error ? <span className="max-w-[14rem] text-right text-xs text-bad">{error}</span> : null}
    </span>
  );
}
