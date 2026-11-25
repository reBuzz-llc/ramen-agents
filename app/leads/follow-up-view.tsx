"use client";

import { useCallback, useEffect, useState } from "react";
import { ago, call, ResultChips } from "@/app/follow-ups";
import PixelLoader from "@/app/pixel-loader";
import { refreshFollowUpCount, setFollowUpCount } from "@/app/use-follow-up-count";
import type { SentLead } from "@/lib/follow-up";
import { MAX_FOLLOW_UPS } from "@/lib/follow-up-drafts";
import type { Budget } from "@/lib/send-goals";
import { missingLine } from "@/lib/agent-presence-text";

type Data = { rows: SentLead[]; today: Record<"email" | "whatsapp", Budget>; canAll: boolean; scope: "mine" | "all"; /** the agent the team does not run, else "" */ missing?: string };

const LABEL = { email: "Email", whatsapp: "WhatsApp" } as const;

/** The line about today's counts. Reaching one never blocks Mark sent: a person may already have sent it. */
export function dayLine(today: Data["today"]): { text: string; reached: boolean } {
  const reached = (["email", "whatsapp"] as const).filter((c) => today[c].goal > 0 && today[c].sent >= today[c].goal);
  const count = (c: "email" | "whatsapp") => `${today[c].sent} of ${today[c].goal} ${c === "email" ? "emails" : "WhatsApp"}`;
  if (reached.length) return { reached: true, text: `Today's count is reached: ${reached.map(count).join(" and ")}. Mark sent still records what you sent.` };
  return { reached: false, text: `Today so far: ${count("email")}, ${count("whatsapp")}. Follow-ups count here too.` };
}

function Row({ l, showWho, busy, onOpen, act }: { l: SentLead; showWho: boolean; busy: string; onOpen: (id: string) => void; act: (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(l.followUp);
  const canCopy = !!l.followUp && !l.hold;
  const save = () => act(l.id, () => call(`/api/leads/${l.id}`, "PATCH", { fields: { followup_drafts: { [l.step]: { text: value, channel: l.channel } } } }), `${l.business}: draft saved.`).then(() => setEditing(false));
  const copy = () => act(l.id, async () => {
    try {
      await navigator.clipboard.writeText(l.followUp);
      return { ok: true };
    } catch {
      return { ok: false, error: "Copy failed: select the text and copy it." };
    }
  }, "Follow-up copied.");
  return (
    <li data-follow-up={l.id} className="rounded-xl border border-line bg-panel p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <button type="button" onClick={() => onOpen(l.id)} className="min-h-9 text-left font-semibold hover:underline">
          {l.business}
        </button>
        <span className="text-xs text-muted">
          Follow-up {l.step} of {MAX_FOLLOW_UPS} · {LABEL[l.channel]} · sent {ago(l.sentAt)}
          {showWho && l.sentBy.length ? ` · by ${l.sentBy.join(", ")}` : ""}
        </span>
      </div>
      {l.hold ? <p role="alert" className="mt-2 text-sm text-bad">{l.hold}</p> : null}
      {editing ? (
        <div className="mt-2">
          <textarea value={value} onChange={(e) => setValue(e.target.value)} rows={Math.min(14, Math.max(4, value.split("\n").length + 1))} aria-label={`Follow-up ${l.step} for ${l.business}`} className="block w-full rounded-lg border border-accent bg-bg p-3 text-sm text-ink" />
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <button type="button" disabled={busy === l.id || !value.trim() || value === l.followUp} onClick={() => void save()} className="inline-flex min-h-9 items-center rounded-full bg-accent px-3 text-sm font-semibold text-on-accent disabled:opacity-50">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="min-h-9 text-sm text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      ) : l.followUp ? (
        <pre className="mt-2 max-h-56 overflow-auto rounded-lg border border-line bg-bg p-3 font-sans text-sm whitespace-pre-wrap">{l.followUp}</pre>
      ) : (
        <p data-no-draft className="mt-2 rounded-lg border border-line bg-bg p-3 text-muted">No draft yet.</p>
      )}
      {!editing ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" disabled={!canCopy} onClick={() => void copy()} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold hover:border-accent disabled:opacity-50">
            Copy
          </button>
          <button type="button" disabled={busy === l.id} onClick={() => void act(l.id, () => call("/api/follow-up", "POST", { id: l.id, step: l.step, channel: l.channel }), `${l.business}: follow-up ${l.step} recorded.`)} className="inline-flex min-h-11 items-center rounded-full bg-accent px-4 text-sm font-semibold text-on-accent hover:bg-accent-hover disabled:opacity-50">
            Mark sent
          </button>
          <button
            type="button"
            onClick={() => {
              setValue(l.followUp);
              setEditing(true);
            }}
            className="inline-flex min-h-11 items-center px-2 text-sm font-medium text-accent-ink hover:underline"
          >
            {l.followUp ? "Edit" : "Write one"}
          </button>
        </div>
      ) : null}
      <div className="mt-2">
        <ResultChips l={l} busy={busy} act={(id, fn, done) => void act(id, fn, done)} />
      </div>
    </li>
  );
}

/** The Follow up tab: leads sent 2, 5 and 14 days ago with no reply. Peek never sends: draft, Copy, Mark sent. */
export default function FollowUpView({ onOpen, paused, onOrder }: { onOpen: (id: string) => void; paused: boolean; onOrder?: (ids: string[]) => void }) {
  const [scope, setScope] = useState<"mine" | "all">("mine");
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(async (who: "mine" | "all") => {
    const r = await fetch(`/api/follow-up?who=${who}`, { credentials: "same-origin" }).catch(() => null);
    const j = r?.ok ? ((await r.json().catch(() => null)) as Data | null) : null;
    if (j) setData(j);
    setFailed(!j);
    // "Mine" is the count itself; "Everyone" is not, so that one still asks
    if (j?.scope === "mine") setFollowUpCount(j.rows.length);
    else refreshFollowUpCount();
  }, []);
  // read again whenever the drawer closes, since a result set there can take a lead off the list
  useEffect(() => {
    if (paused) return;
    let live = true;
    void Promise.resolve().then(() => (live ? load(scope) : undefined));
    return () => {
      live = false;
    };
  }, [load, paused, scope]);
  useEffect(() => {
    if (data) onOrder?.([...new Set(data.rows.map((l) => l.id))]);
  }, [data, onOrder]);
  const act = async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) => {
    setBusy(id);
    const r = await fn();
    setNote(r.ok ? done : (r.error ?? "That failed."));
    if (done !== "Follow-up copied.") await load(scope);
    setBusy("");
  };
  const day = data ? dayLine(data.today) : null;
  return (
    <section aria-label="Follow up" className="mt-4">
      <p className="text-sm text-muted">Leads sent 2, 5 and 14 days ago with no reply. Copy the follow-up, send it from your own mailbox or WhatsApp, then press Mark sent. A reply or a no takes the lead off this list.</p>
      {data?.canAll ? (
        <div role="group" aria-label="Whose follow-ups" className="mt-3 inline-flex rounded-full border border-line p-0.5 text-sm">
          {(["mine", "all"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)} className={`min-h-9 rounded-full px-4 ${scope === k ? "bg-accent font-semibold text-on-accent" : "text-muted hover:text-ink"}`}>
              {k === "mine" ? "Mine" : "Everyone"}
            </button>
          ))}
        </div>
      ) : null}
      {data?.missing ? (
        <p data-agent-missing className="mt-2 text-sm text-muted">
          {missingLine("Follow-up drafts", data.missing)}
        </p>
      ) : null}
      {day ? <p data-day-count={day.reached ? "reached" : "open"} className={`mt-3 text-sm ${day.reached ? "font-semibold" : "text-muted"}`}>{day.text}</p> : null}
      {note ? <p role="status" className="mt-2 text-sm">{note}</p> : null}
      {failed ? <p className="mt-3 text-sm text-bad">Could not load the follow-ups. Try again in a moment.</p> : null}
      <PixelLoader active={!data && !failed} label="Loading the follow-ups…" />
      {data && !data.rows.length ? <p className="mt-3 rounded-xl border border-line bg-panel p-4 text-sm text-muted">No follow-ups due. A lead appears here 2 days after it is sent.</p> : null}
      {data?.rows.length ? (
        <ol className="mt-3 space-y-2">
          {data.rows.map((l) => (
            <Row key={`${l.id}:${l.step}`} l={l} showWho={data.scope === "all"} busy={busy} onOpen={onOpen} act={act} />
          ))}
        </ol>
      ) : null}
    </section>
  );
}
