"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass, Spinner } from "./ui";

type Draft = { name: string; goal: string; persona: [string, string][] };

/** Approve / Decline for one roster proposal (queue 440), with a one-line note. A create shows its name, goal and persona
 *  text as fields the owner may edit before approving; only what changed is sent. A start or stop takes up to two
 *  minutes (the owner's own start path restarts the member). */
export default function RosterProposalActions({ id, action, draft }: { id: string; action: string; draft?: Draft | null }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [name, setName] = useState(draft?.name ?? "");
  const [goal, setGoal] = useState(draft?.goal ?? "");
  const [persona, setPersona] = useState<Record<string, string>>(Object.fromEntries(draft?.persona ?? []));
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState("");

  async function send(approve: boolean) {
    setBusy(approve ? "approve" : "decline");
    setError("");
    const edits: Record<string, unknown> = {};
    if (draft && approve) {
      if (name.trim() !== draft.name) edits.name = name;
      if (goal.trim() !== draft.goal) edits.goal = goal;
      const changed = Object.fromEntries(draft.persona.filter(([h, t]) => (persona[h] ?? "").trim() !== t).map(([h]) => [h, persona[h] ?? ""]));
      if (Object.keys(changed).length) edits.persona = changed;
    }
    try {
      const res = await fetch("/api/roster-proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, approve, note, edits }),
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

  const field = "w-full min-w-0 rounded-md border border-line bg-transparent px-2 py-1 text-xs text-ink";
  return (
    <div className="mt-1.5 space-y-1.5">
      {draft ? (
        <div className="space-y-1.5">
          <label className="block text-xs text-muted">
            Name
            <input className={`${field} mt-0.5`} maxLength={40} value={name} onChange={(e) => setName(e.target.value)} disabled={busy !== null} />
          </label>
          <label className="block text-xs text-muted">
            Goal
            <textarea className={`${field} mt-0.5`} rows={2} maxLength={200} value={goal} onChange={(e) => setGoal(e.target.value)} disabled={busy !== null} />
          </label>
          {draft.persona.length ? (
            <details>
              <summary className="cursor-pointer text-xs text-muted">Persona ({draft.persona.length} sections, editable)</summary>
              <div className="mt-1 space-y-1.5">
                {draft.persona.map(([h]) => (
                  <label key={h} className="block text-xs text-muted">
                    {h}
                    <textarea
                      className={`${field} mt-0.5`}
                      rows={4}
                      maxLength={1500}
                      value={persona[h] ?? ""}
                      onChange={(e) => setPersona((p) => ({ ...p, [h]: e.target.value }))}
                      disabled={busy !== null}
                    />
                  </label>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <input
          className="h-7 min-w-0 flex-1 rounded-md border border-line bg-transparent px-2 text-xs text-ink"
          placeholder="Note (optional)"
          maxLength={300}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          disabled={busy !== null}
        />
        <button type="button" className={buttonClass("prominent", "sm")} disabled={busy !== null} onClick={() => void send(true)}>
          {busy === "approve" ? <Spinner small /> : null}
          Approve
        </button>
        <button type="button" className={buttonClass("gray", "sm")} disabled={busy !== null} onClick={() => void send(false)}>
          {busy === "decline" ? <Spinner small /> : null}
          Decline
        </button>
      </div>
      {busy === "approve" && (action === "start" || action === "stop") ? <p className="text-xs text-muted">Working: a start or stop can take two minutes.</p> : null}
      {error ? <p className="text-xs text-bad">{error}</p> : null}
    </div>
  );
}
