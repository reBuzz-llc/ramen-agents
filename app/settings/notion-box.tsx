"use client";
// Settings → Notion. Connected: a status card (boards by title, last refresh, rows in the queue) with Refresh now,
// Change boards and Disconnect. Not connected, or changing: paste a token, pick the boards from what the token can see;
// an id or a board link can be pasted under "advanced". Raw ids appear only there.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { control, PendingButton, PendingForm } from "../ui";
import type { Board } from "@/lib/notion-pick";

export type Connected = { leads: string; tasks: string | null; leadsTitle: string | null; tasksTitle: string | null; as: string | null; devFile: boolean; lastRefresh: string | null; queued: number };

const input = control;
const quiet = "inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold hover:border-accent disabled:cursor-not-allowed disabled:opacity-50";

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "not yet";

type Found = { ok: boolean; boards?: Board[]; reason?: string };

/** The boards a token can see; an empty token means the company's stored one. */
async function listBoards(token: string): Promise<Found> {
  return fetch("/api/notion/boards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) })
    .then((x) => x.json())
    .catch(() => ({ ok: false, reason: "Could not reach ramen-agents." }));
}

export default function NotionBox({ connected }: { connected: Connected | null }) {
  // null: show the card (when connected); a Found: change boards, starting from what the stored token sees.
  const [editing, setEditing] = useState<Found | null>(connected ? null : { ok: true });
  return connected && !editing ? (
    <Card c={connected} onChange={async () => setEditing(await listBoards(""))} />
  ) : (
    <Picker current={connected} first={editing ?? { ok: true }} onCancel={connected ? () => setEditing(null) : null} />
  );
}

function Card({ c, onChange }: { c: Connected; onChange: () => Promise<void> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState("");
  async function refresh() {
    setBusy(true);
    setNote("");
    const r = (await fetch("/api/queue?fresh=1").then((x) => x.json()).catch(() => ({ ok: false, reason: "Could not reach ramen-agents." }))) as { ok: boolean; reason?: string };
    setBusy(false);
    if (!r.ok) setNote(r.reason ?? "Notion did not answer.");
    router.refresh();
  }
  return (
    <div className="mt-3 rounded-xl border border-line bg-panel p-4" data-testid="notion-card">
      <p className="text-sm">
        <span className="font-semibold text-good">● Connected</span> · Leads: <b>{c.leadsTitle ?? "your Leads board"}</b> · Tasks: <b>{c.tasks ? (c.tasksTitle ?? "your task board") : "not set"}</b>
      </p>
      <p className="mt-1 text-xs text-muted">
        {c.devFile ? "Connected from NOTION_TOKEN_FILE (dev)" : `Connected as ${c.as ?? "your integration"}`} · token saved (encrypted) · last refresh {when(c.lastRefresh)} · {c.queued} {c.queued === 1 ? "row" : "rows"} in the queue
      </p>
      {note ? <p className="mt-2 text-sm text-bad">{note}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">
        <PendingButton pending={busy} pendingLabel="Refreshing…" onClick={refresh}>
          Refresh now
        </PendingButton>
        <PendingButton
          variant="quiet"
          pending={changing}
          disabled={busy}
          onClick={async () => {
            setChanging(true);
            await onChange();
            setChanging(false);
          }}
        >
          Change boards
        </PendingButton>
        <PendingForm
          action="/api/settings"
          method="post"
          onSubmit={(e) => {
            if (!confirm("Disconnect Notion? The stored token and the cached rows are deleted here. Your board in Notion is not changed.")) e.preventDefault();
          }}
        >
          <input type="hidden" name="action" value="notionDisconnect" />
          <PendingButton variant="danger" disabled={busy || changing}>
            Disconnect
          </PendingButton>
        </PendingForm>
      </div>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer">advanced</summary>
        <p className="mt-1 font-mono">Leads data source {c.leads}</p>
        {c.tasks ? <p className="font-mono">Task data source {c.tasks}</p> : null}
      </details>
    </div>
  );
}

function Picker({ current, first, onCancel }: { current: Connected | null; first: Found; onCancel: (() => void) | null }) {
  const [token, setToken] = useState("");
  const [boards, setBoards] = useState<Board[] | null>(first.boards ?? null);
  const [leads, setLeads] = useState(current?.leads ?? "");
  const [tasks, setTasks] = useState(current?.tasks ?? "");
  const [reason, setReason] = useState(first.ok ? "" : (first.reason ?? ""));
  const [busy, setBusy] = useState(false);

  async function find(t: string) {
    setBusy(true);
    setReason("");
    const r = await listBoards(t);
    setBusy(false);
    const all = r.boards ?? [];
    setBoards(all);
    if (!r.ok) setReason(r.reason ?? "Notion did not answer.");
    // Preselect: the current choice, else the only board that looks like a Leads board.
    const likely = all.filter((b) => b.leadsLike);
    setLeads((v) => (v && all.some((b) => b.id === v) ? v : likely.length === 1 ? likely[0].id : v));
  }

  const chosen = (id: string) => boards?.find((b) => b.id === id);
  const cols = (b: Board | undefined) => (b ? b.columns.slice(0, 6).join(", ") + (b.columns.length > 6 ? ", …" : "") : "");

  return (
    <PendingForm action="/api/settings" method="post" className="mt-3 space-y-3 rounded-xl border border-line bg-panel p-4">
      <input type="hidden" name="action" value="notion" />
      <p className="text-xs text-muted">
        Make a token in Notion: Settings → Connections → Develop or manage integrations → New integration, then copy its secret. Share each board with it:
        open the board → ··· → Connections → add it. <Link href="/help/connect-notion" className="text-accent-ink underline">How do I get a token?</Link>
      </p>

      {current ? (
        <details>
          <summary className="cursor-pointer text-sm">Replace token</summary>
          <TokenRow token={token} setToken={setToken} busy={busy} find={find} label="Find boards with this token" />
        </details>
      ) : (
        <TokenRow token={token} setToken={setToken} busy={busy} find={find} label="Find my boards" />
      )}

      {reason ? <p className="text-sm text-bad">{reason}</p> : null}

      {boards && boards.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs text-muted">
            Leads board
            <select name="leads" value={leads} onChange={(e) => setLeads(e.target.value)} className={input}>
              <option value="">Choose…</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                  {b.leadsLike ? " (looks like Leads)" : ""}
                </option>
              ))}
            </select>
            <span className="mt-1 block">{cols(chosen(leads))}</span>
          </label>
          <label className="text-xs text-muted">
            Task board (optional)
            <select name="tasks" value={tasks} onChange={(e) => setTasks(e.target.value)} className={input}>
              <option value="">No task board</option>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
            <span className="mt-1 block">{cols(chosen(tasks))}</span>
          </label>
        </div>
      ) : null}

      <details className="text-xs text-muted">
        <summary className="inline-flex min-h-11 cursor-pointer items-center">Advanced: paste an id or a Notion link</summary>
        <p className="mt-1">The id is the 32 letters and digits at the end of a board&apos;s link, before any &quot;?v=&quot;. A pasted link or id wins over the list.</p>
        <input name="leadsRaw" placeholder="Leads board link or id" className={`${input} mt-1`} />
        <input name="tasksRaw" placeholder="Task board link or id (optional)" className={`${input} mt-1`} />
        {current ? <p className="mt-1 font-mono">Now: Leads {current.leads}{current.tasks ? ` · Tasks ${current.tasks}` : ""}</p> : null}
      </details>

      <div className="flex gap-2">
        <PendingButton disabled={busy}>Connect</PendingButton>
        {onCancel ? (
          <button type="button" className={quiet} onClick={onCancel}>
            Cancel
          </button>
        ) : null}
      </div>
    </PendingForm>
  );
}

function TokenRow(p: { token: string; setToken: (v: string) => void; busy: boolean; find: (t: string) => void; label: string }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <input name="token" type="password" autoComplete="off" value={p.token} onChange={(e) => p.setToken(e.target.value)} placeholder="Notion token (ntn_…)" className={`${input} min-w-0 flex-1`} />
      <PendingButton type="button" variant="quiet" pending={p.busy} pendingLabel="Looking…" disabled={!p.token.trim()} onClick={() => p.find(p.token.trim())}>
        {p.label}
      </PendingButton>
    </div>
  );
}
