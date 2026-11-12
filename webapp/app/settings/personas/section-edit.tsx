"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, Spinner } from "../../ui";

/** Edit for one of the owner's persona sections (queue 489): the text as it is, Save writes it; the agent reads it on its
 *  next step (no restart). */
export default function SectionEdit({ bot, section, body }: { bot: string; section: string; body: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(body.trim());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!open)
    return (
      <button type="button" className={buttonClass("gray", "sm")} onClick={() => setOpen(true)}>
        Edit
      </button>
    );
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/personas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ bot, section, before: body, text }) });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(d.error ?? `could not save (${res.status})`);
      else {
        setOpen(false);
        router.refresh();
      }
    } catch {
      setError("could not reach the dashboard");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-2 space-y-2">
      <textarea
        aria-label={`Edit the section ${section}`}
        className="w-full min-w-0 rounded-lg bg-fill-3 px-3 py-2 font-mono text-sm text-ink focus:ring-2 focus:ring-sys-blue/40 focus:outline-none"
        rows={Math.min(18, Math.max(5, text.split("\n").length + 1))}
        maxLength={4000}
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass("prominent", "sm")} disabled={busy || !text.trim() || text.trim() === body.trim()} onClick={() => void save()}>
          {busy ? <Spinner small /> : null}
          Save
        </button>
        <button type="button" className={buttonClass("gray", "sm")} disabled={busy} onClick={() => { setOpen(false); setText(body.trim()); setError(""); }}>
          Cancel
        </button>
        <span className="text-xs text-muted">The agent reads it on its next step; no restart.</span>
      </div>
      {error ? <p className="text-xs text-bad">{error}</p> : null}
    </div>
  );
}
