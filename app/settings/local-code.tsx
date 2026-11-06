"use client";
// Settings → People, local mode only: a person's sign-in code, issued here and shown once, to pass
// on by hand (a message, in person). A new code replaces the old one.
import { useState } from "react";
import { btnText } from "@/lib/ui-classes";

export default function LocalCode({ userId, label }: { userId: string; label: string }) {
  const [code, setCode] = useState<{ code: string; until: string } | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const issue = async () => {
    if (!window.confirm(`A new local sign-in code for ${label}? Their older code stops working.`)) return;
    setBusy(true);
    setError("");
    const r = await fetch("/api/local-codes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ userId }) })
      .then((x) => x.json())
      .catch(() => ({ ok: false, error: "No answer." }));
    setBusy(false);
    if (!r.ok) return setError(r.error ?? "Not issued.");
    setCode({ code: r.code, until: new Date(r.expiresAt).toLocaleDateString(undefined, { day: "numeric", month: "short" }) });
  };
  return code ? (
    <p className="rounded-lg bg-accent-tint px-3 py-2 text-sm">
      Local sign-in code for {label}: <code className="font-mono text-base font-semibold tracking-wider select-all">{code.code}</code> · until {code.until}. Shown
      once: pass it on now.
    </p>
  ) : (
    <span className="inline-flex items-center gap-2">
      <button type="button" className={btnText} disabled={busy} onClick={() => void issue()}>
        {busy ? "Issuing…" : "Local sign-in code"}
      </button>
      {error ? <span className="text-xs text-bad">{error}</span> : null}
    </span>
  );
}
