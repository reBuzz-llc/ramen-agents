"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, Spinner } from "./ui";

/** Build / Later / No on a member's wish (creatorCC queue 478), with a note the member reads (No needs one). */
export default function ForgeActions({ id }: { id: string }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function send(status: "build" | "later" | "no") {
    setBusy(status);
    setError("");
    try {
      const res = await fetch("/api/forge", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, status, note }) });
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
    <div className="mt-1.5 space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-7 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 text-xs text-ink"
          placeholder="Note for the member (needed for No)"
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy !== null}
        />
        {(["build", "later", "no"] as const).map((s) => (
          <button key={s} type="button" className={buttonClass(s === "build" ? "prominent" : "gray", "sm")} disabled={busy !== null || (s === "no" && !note.trim())} onClick={() => void send(s)}>
            {busy === s ? <Spinner small /> : null}
            {s === "build" ? "Build" : s === "later" ? "Later" : "No"}
          </button>
        ))}
      </div>
      {error ? <p className="text-xs text-bad">{error}</p> : null}
    </div>
  );
}
