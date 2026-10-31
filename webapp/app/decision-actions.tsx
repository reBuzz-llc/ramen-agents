"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, Spinner } from "./ui";

type DecisionAction = "choose" | "done" | "later";

/** One answer to an owner's decision: the same POST from the decisions box and the world's bulletin board. */
export function useDecisionAnswer(onSaved: () => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function answer(id: string, action: DecisionAction, note: string, choice = "") {
    setBusy(choice || action);
    setError("");
    try {
      const res = await fetch("/api/owner-decisions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, action, choice, note: note.trim().slice(0, 300) }) });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (res.ok) onSaved();
      else setError(data.error ?? `could not save (${res.status})`);
    } catch {
      setError("could not reach the dashboard");
    } finally {
      setBusy(null);
    }
  }
  return { answer, busy, error };
}

/** One button per option (the owner's choice), Done and Later (back in three days), and a one-line note. */
export default function DecisionActions({ id, options }: { id: string; options: string[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const { answer, busy, error } = useDecisionAnswer(() => router.refresh());
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      {options.map((o, i) => (
        <button key={o} type="button" className={buttonClass(i === 0 ? "prominent" : "gray", "sm")} disabled={busy !== null} onClick={() => void answer(id, "choose", note, o)}>
          {busy === o ? <Spinner small /> : null}
          {o}
        </button>
      ))}
      <button type="button" className={buttonClass("gray", "sm")} disabled={busy !== null} onClick={() => void answer(id, "done", note)}>
        {busy === "done" ? <Spinner small /> : null}
        Done
      </button>
      <button type="button" className={buttonClass("gray", "sm")} disabled={busy !== null} onClick={() => void answer(id, "later", note)} title="Hide it for three days">
        {busy === "later" ? <Spinner small /> : null}
        Later
      </button>
      <input
        className="h-7 min-w-[10rem] flex-1 rounded-md border border-line bg-transparent px-2 text-xs text-ink"
        placeholder="Note (optional)"
        aria-label="Note"
        maxLength={300}
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={busy !== null}
      />
      {error ? <p className="w-full text-xs text-bad">{error}</p> : null}
    </div>
  );
}
