"use client";

import { useState } from "react";

/** A draft shown in the pack, editable in place: Edit turns it into a text box; Save writes it as the
 *  person (PATCH /api/leads/{id}, so the person's text wins over the agents', the agents' text is kept beside it, and the
 *  change is in the lead's History); Cancel drops the change. `onSaved` hands the saved text up, so Copy uses it at once. */
export default function DraftBox({ leadId, field, text, onSaved }: { leadId: string; field: "draft_email" | "draft_whatsapp"; text: string; onSaved: (text: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch(`/api/leads/${leadId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: { [field]: value } }) });
      const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!r.ok || j.ok === false) throw new Error(j.error ?? `the server answered ${r.status}`);
      onSaved(value);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (!editing)
    return (
      <div className="mt-2">
        <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-3 font-sans text-sm">{text}</pre>
        <button
          type="button"
          onClick={() => {
            setValue(text);
            setEditing(true);
          }}
          className="mt-1 text-sm font-medium text-accent-ink hover:underline"
        >
          Edit
        </button>
      </div>
    );
  return (
    <div className="mt-2">
      <textarea
        value={value}
        onChange={(e) => setValue(e.target.value)}
        rows={Math.min(18, Math.max(6, value.split("\n").length + 1))}
        aria-label={field === "draft_email" ? "Draft email" : "Draft WhatsApp message"}
        className="block w-full rounded-lg border border-accent bg-bg p-3 text-sm text-ink"
      />
      <div className="mt-1 flex flex-wrap items-center gap-3">
        <button type="button" disabled={busy || !value.trim() || value === text} onClick={save} className="inline-flex min-h-9 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50">
          {busy ? "Saving…" : "Save"}
        </button>
        <button type="button" disabled={busy} onClick={() => setEditing(false)} className="text-sm text-muted hover:text-ink">
          Cancel
        </button>
        <span className="text-xs text-muted">Your version wins over the agents&apos;; theirs is kept beside it.</span>
        {error ? <span className="text-xs text-bad">{error}</span> : null}
      </div>
    </div>
  );
}
