"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { SentLead } from "@/lib/follow-up";

/** The result chips: the drawer's steps (Replied, Meeting booked, Lost, Bounced) as one click. */
const RESULTS: { result: string; label: string; tone: string }[] = [
  { result: "Replied", label: "Replied", tone: "border-accent" },
  { result: "Meeting", label: "Meeting booked", tone: "border-accent" },
  { result: "Not interested", label: "Not interested", tone: "border-line" },
  { result: "Bounced", label: "Bounced", tone: "border-line" },
];

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const ago = (iso: string) => {
  const days = Math.max(0, Math.round((Date.parse(today()) - Date.parse(iso.slice(0, 10))) / 86_400_000));
  return days === 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
};

async function call(url: string, method: string, body: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    return { ok: r.ok && j.ok !== false, error: j.error };
  } catch {
    return { ok: false, error: "No answer from the server; check the connection and try again." };
  }
}

function Chips({ l, busy, act }: { l: SentLead; busy: string; act: (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => void }) {
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      {RESULTS.map((r) => (
        <button
          key={r.result}
          type="button"
          disabled={busy === l.id}
          onClick={() => act(l.id, () => call(`/api/leads/${l.id}`, "PATCH", { fields: { result: r.result, result_date: today() } }), `${l.business}: ${r.label}.`)}
          className={`inline-flex min-h-9 items-center rounded-full border ${r.tone} px-3 text-xs font-semibold hover:bg-accent-tint disabled:opacity-50`}
        >
          {r.label}
        </button>
      ))}
    </span>
  );
}

/** Follow up and record the result, on the Clock home under the send pack. */
export default function FollowUps({ due, waiting }: { due: SentLead[]; waiting: SentLead[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const act = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(id);
    const r = await fn();
    setBusy("");
    setNote(r.ok ? done : (r.error ?? "That failed."));
    router.refresh();
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNote("Follow-up copied.");
    } catch {
      setNote("Copy failed: select the text and copy it.");
    }
  };

  return (
    <section aria-labelledby="follow-ups" className="mt-10">
      <h2 id="follow-ups" className="text-lg font-semibold">
        Follow up <span className="text-sm font-normal text-muted tabular-nums">{due.length}</span>
      </h2>
      <p className="mt-1 text-sm text-muted">
        Leads you sent {4} or more working days ago with no answer yet. Most replies come after a short second note: copy it, send it from your own mailbox, then press
        Follow-up sent. Got an answer? Press what it was.
      </p>
      {note ? (
        <p role="status" className="mt-2 text-sm">
          {note}
        </p>
      ) : null}
      {due.length === 0 ? (
        <p className="mt-3 rounded-xl border border-line bg-panel p-4 text-sm text-muted">No follow-ups due. They appear here four working days after you send.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {due.map((l) => {
            const expanded = open === l.id;
            const text = texts[l.id] ?? l.followUp;
            return (
              <li key={l.id} className="rounded-xl border border-line bg-panel text-sm">
                <button type="button" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : l.id)} className="flex w-full flex-wrap items-baseline justify-between gap-2 p-3 text-left">
                  <span className="font-semibold">{l.business}</span>
                  <span className="text-xs text-muted">
                    sent {ago(l.sentAt)} · {l.email ?? "no email"}
                  </span>
                </button>
                {expanded ? (
                  <div className="border-t border-line p-3">
                    <details>
                      <summary className="cursor-pointer text-xs text-muted">What you sent first</summary>
                      <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg border border-line bg-bg p-3 font-sans text-sm">{l.draft ?? "(no draft on the lead)"}</pre>
                    </details>
                    <label className="mt-3 block text-xs text-muted">
                      The follow-up {l.followUpByAgent ? "(drafted by the agents)" : "(a two-line note: make it yours)"}
                      <textarea
                        value={text}
                        onChange={(e) => setTexts((t) => ({ ...t, [l.id]: e.target.value }))}
                        rows={4}
                        className="mt-1 block w-full rounded-lg border border-line bg-bg p-3 text-sm text-ink"
                      />
                    </label>
                    <div className="mt-2 flex flex-wrap items-center gap-3">
                      <button type="button" onClick={() => copy(text)} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold hover:border-accent">
                        Copy follow-up
                      </button>
                      <button
                        type="button"
                        disabled={busy === l.id}
                        onClick={() => act(l.id, () => call("/api/follow-up", "POST", { id: l.id }), `${l.business}: follow-up recorded.`)}
                        className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50"
                      >
                        Follow-up sent
                      </button>
                      <Link href={`/leads?tab=board&lead=${l.id}`} className="inline-flex min-h-11 items-center text-sm text-accent-ink hover:underline">
                        Open the lead
                      </Link>
                    </div>
                    <div className="mt-3">
                      <Chips l={l} busy={busy} act={act} />
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {waiting.length ? (
        <div className="mt-6">
          <h3 className="text-sm font-semibold">Sent by you, no answer yet</h3>
          <ul className="mt-2 divide-y divide-line rounded-xl border border-line text-sm">
            {waiting.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <span className="min-w-0">
                  <Link href={`/leads?tab=board&lead=${l.id}`} className="font-medium hover:underline">
                    {l.business}
                  </Link>
                  <span className="text-xs text-muted"> · sent {ago(l.sentAt)}</span>
                </span>
                <Chips l={l} busy={busy} act={act} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
