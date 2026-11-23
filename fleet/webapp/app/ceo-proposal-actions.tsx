"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, Spinner } from "./ui";

/** Approve / Decline for one CEO proposal, with an optional one-line note. */
export default function CeoProposalActions({ id, canApprove }: { id: string; canApprove: boolean }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState("");

  async function send(action: "approve" | "decline") {
    setBusy(action);
    setError("");
    try {
      const res = await fetch("/api/ceo-proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action, note }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) setError(data.error ?? `could not save (${res.status})`);
      else router.refresh();
    } catch {
      setError("could not reach the dashboard");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <input
        className="h-7 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 text-xs text-ink"
        placeholder="Note (optional)"
        maxLength={300}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={busy !== null}
      />
      <button type="button" className={buttonClass("prominent", "sm")} disabled={busy !== null || !canApprove} onClick={() => void send("approve")}>
        {busy === "approve" ? <Spinner small /> : null}
        Approve
      </button>
      <button type="button" className={buttonClass("gray", "sm")} disabled={busy !== null} onClick={() => void send("decline")}>
        {busy === "decline" ? <Spinner small /> : null}
        Decline
      </button>
      {error ? <p className="w-full text-xs text-bad">{error}</p> : null}
    </div>
  );
}
