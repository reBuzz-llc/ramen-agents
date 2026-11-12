"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, Spinner } from "./ui";

/** Done for one of the owner's items (queue 401): the item leaves the Decisions box once saved. A persona item (queue
 *  440) reads Keep and Revert: Revert writes the section's earlier text back into the persona first. */
export default function OwnerItemDone({ id, revert = false }: { id: string; revert?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"done" | "revert" | null>(null);
  const [error, setError] = useState("");
  async function send(kind: "done" | "revert") {
    setBusy(kind);
    setError("");
    try {
      const res = await fetch("/api/owner-items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(kind === "revert" ? { id, revert: true } : { id }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) router.refresh();
      else setError(data.error ?? `could not save (${res.status})`);
    } catch {
      setError("could not reach the dashboard");
    } finally {
      setBusy(null);
    }
  }
  return (
    <span className="inline-flex shrink-0 flex-col items-end">
      <span className="inline-flex gap-1.5">
        {revert ? (
          <button type="button" className={buttonClass("gray", "sm")} disabled={busy !== null} onClick={() => void send("revert")} title="Put the section's earlier text back">
            {busy === "revert" ? <Spinner small /> : null}
            Revert
          </button>
        ) : null}
        <button type="button" className={buttonClass("gray", "sm")} disabled={busy !== null} onClick={() => void send("done")}>
          {busy === "done" ? <Spinner small /> : null}
          {revert ? "Keep" : "Done"}
        </button>
      </span>
      {error ? <span className="max-w-[14rem] text-right text-xs text-bad">{error}</span> : null}
    </span>
  );
}
