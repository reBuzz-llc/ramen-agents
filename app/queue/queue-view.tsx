"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { filtersFrom, filtersToQuery, matches, NO_FILTERS, type Filters } from "@/lib/lead-filters";
import type { QueueRow, TaskRow } from "@/lib/queue";
import { STEPS } from "@/lib/task-steps";
import { Busy, PendingButton } from "../ui";
import FilterBar from "./filter-bar";

type Taken = { name: string; mine: boolean; at: string } | null;
type Row = QueueRow & { takenBy: Taken };
type Feed = { ok: boolean; reason?: string; leadsReason?: string; rows: Row[]; canRelease?: boolean; tasks?: TaskRow[]; tasksReason?: string; people?: string[]; sentThisWeek?: number; target?: number | null };

async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function CopyChip({ label, text }: { label: string; text: string | (() => Promise<string>) }) {
  const [state, setState] = useState<"" | "busy" | "done" | "failed">("");
  return (
    <button
      type="button"
      disabled={state === "busy"}
      aria-busy={state === "busy"}
      onClick={async () => {
        setState("busy");
        // A draft not loaded yet is fetched first: what is copied is always the full text, never a preview.
        const value = await (typeof text === "string" ? Promise.resolve(text) : text()).catch(() => null);
        setState(value !== null && (await copy(value)) ? "done" : "failed");
        setTimeout(() => setState(""), 1500);
      }}
      className="inline-flex min-h-11 items-center rounded-full border border-line bg-panel px-4 text-sm font-semibold hover:border-accent disabled:opacity-60"
    >
      {state === "busy" ? "Copying…" : state === "done" ? "Copied" : state === "failed" ? "Not copied, retry" : label}
    </button>
  );
}

const TABS = [
  { key: "review", label: "Review drafts", help: "Drafts the agents wrote that nobody has approved yet. Read it, fix it in Notion if needed, then mark it ready, or send it straight away." },
  { key: "send", label: "Send email", help: "Approved drafts. Copy the address and the draft, send it from your mailbox, then mark it sent." },
  { key: "tasks", label: "Team tasks", help: "Open team tasks: the standing task first, then yours, then by priority. Move each through its steps and tick what is done." },
] as const;
type Tab = (typeof TABS)[number]["key"];

/** Our queue: the team's work, by kind of task. Nothing is sent from here; the only write is a lead's Status. */
export default function QueueView() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [marked, setMarked] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<Tab | null>(null);
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [taken, setTaken] = useState<Record<string, Taken>>({});
  // ?task=<id>&status= (the bots' link <peek>/tasks/<id> lands here): that task's card, open and in view
  const [focus, setFocus] = useState<{ id: string; status: string } | null>(null);
  const load = useCallback(async (fresh = false) => {
    const res = await fetch(`/api/queue${fresh ? "?fresh=1" : ""}`, { cache: "no-store" });
    setFeed((await res.json()) as Feed);
    setTaken({});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams(location.search);
      setFilters(filtersFrom(sp));
      if (sp.get("task")) {
        setFocus({ id: sp.get("task")!, status: sp.get("status") ?? "" });
        setTab("tasks");
      }
      const h = location.hash.slice(1);
      if (TABS.some((x) => x.key === h)) setTab(h as Tab);
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  // A row marked here changes group at once: reviewed moves to Send email, sent leaves the queue.
  const leads = (feed?.rows ?? [])
    .filter((r) => marked[r.pageId] !== "Email Sent")
    .map((r) => (marked[r.pageId] === "Ready to Send Email" ? { ...r, kind: "send" as const } : r))
    .map((r) => (r.pageId in taken ? { ...r, takenBy: taken[r.pageId] } : r));
  // Yours first, then the ones nobody has taken, then the ones others took; best lead first within each.
  const order = (r: Row) => (r.takenBy?.mine ? 0 : r.takenBy ? 2 : 1);
  leads.sort((a, b) => order(a) - order(b));
  // The filters narrow both lead tabs, and the tab counts follow them.
  const visible = leads.filter((r) => matches(r, filters));
  const counts: Record<Tab, number> = { review: visible.filter((r) => r.kind === "review").length, send: visible.filter((r) => r.kind === "send").length, tasks: feed?.tasks?.length ?? 0 };
  const filtered = Object.values(filters).some(Boolean);
  const filter = (f: Filters) => {
    setFilters(f);
    history.replaceState(null, "", `${location.pathname}${filtersToQuery(f)}${location.hash}`);
  };
  // Until someone picks a tab: the first one with work in it.
  const shown: Tab = tab ?? TABS.find((t) => counts[t.key])?.key ?? "review";
  const sent = (feed?.sentThisWeek ?? 0) + Object.values(marked).filter((s) => s === "Email Sent").length;
  const pick = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `${location.pathname}${location.search}#${t}`);
  };

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Our queue</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">
            The team&apos;s work, by kind of task, best lead first. Accept a lead before you work it, so nobody else sends
            the same email. Nothing is sent from here.
          </p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-semibold tabular-nums">
            {sent}
            {feed?.target ? <span className="text-base font-normal text-muted"> / {feed.target}</span> : null}
          </p>
          <p className="text-xs text-muted">sent this week</p>
          <button onClick={() => void load(true)} className="mt-1 inline-flex min-h-11 items-center text-sm text-accent-ink hover:underline">Refresh from Notion</button>
        </div>
      </div>

      <div role="tablist" className="mt-6 flex flex-wrap gap-2 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={shown === t.key}
            onClick={() => pick(t.key)}
            className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-3 text-sm ${shown === t.key ? "border-accent font-semibold text-ink" : "border-transparent text-muted hover:text-ink"}`}
          >
            {t.label} <span className="ml-1 rounded-full bg-panel px-2 text-xs tabular-nums">{feed ? counts[t.key] : "…"}</span>
          </button>
        ))}
      </div>
      <p className="mt-3 max-w-2xl text-sm text-muted">{TABS.find((t) => t.key === shown)!.help}</p>

      {!feed ? <p className="mt-6 text-sm text-muted">Reading the board…</p> : null}
      {feed && (!feed.ok || (feed.leadsReason && shown !== "tasks")) ? (
        <p className="mt-6 rounded-xl bg-panel p-4 text-sm text-muted">
          {feed.ok ? feed.leadsReason : feed.reason}{" "}
          {/Settings/.test((feed.ok ? feed.leadsReason : feed.reason) ?? "") ? (
            <a href="/settings/board" className="text-accent-ink underline">
              Open Settings
            </a>
          ) : null}
        </p>
      ) : null}

      {feed?.ok && !feed.leadsReason && shown !== "tasks" ? (
        <>
          <FilterBar
            rows={leads.filter((r) => r.kind === shown)}
            f={filters}
            set={filter}
            shown={counts[shown]}
            total={leads.filter((r) => r.kind === shown).length}
          />
          {!counts[shown] ? <p className="mt-6 rounded-xl bg-panel p-4 text-sm text-muted">{filtered ? "No leads match these filters." : "Nothing waiting here."}</p> : null}
          <ul className="mt-4 space-y-4">
            {visible
              .filter((r) => r.kind === shown)
              .map((r, i) => (
                <Card
                  key={r.pageId}
                  row={r}
                  rank={i + 1}
                  status={marked[r.pageId] ?? r.status}
                  canRelease={!!feed.canRelease}
                  onMarked={(s) => setMarked((m) => ({ ...m, [r.pageId]: s }))}
                  onTaken={(t) => setTaken((m) => ({ ...m, [r.pageId]: t }))}
                  reload={() => void load()}
                />
              ))}
          </ul>
        </>
      ) : null}

      {feed?.ok && shown === "tasks" ? (
        feed.tasks?.some((t) => t.source === "peek") ? (
          <PeekTasks tasks={feed.tasks} people={feed.people ?? []} canRelease={!!feed.canRelease} focus={focus} />
        ) : (
          <Tasks tasks={feed.tasks ?? []} reason={feed.tasksReason} />
        )
      ) : null}
    </div>
  );
}

function Tasks({ tasks, reason }: { tasks: TaskRow[]; reason?: string }) {
  if (reason) return <p className="mt-6 rounded-xl bg-panel p-4 text-sm text-muted">{reason}</p>;
  if (!tasks.length) return <p className="mt-6 rounded-xl bg-panel p-4 text-sm text-muted">No open tasks, or no task board connected (Settings).</p>;
  return (
    <ul className="mt-4 divide-y divide-line rounded-xl border border-line bg-panel">
      {tasks.map((t) => (
        <li key={t.pageId} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <p className="font-medium">
              {t.url ? (
                <a href={t.url} target="_blank" rel="noreferrer" className="hover:text-accent">
                  {t.task}
                </a>
              ) : (
                t.task
              )}
            </p>
            <p className="text-xs text-muted">
              {t.mine ? "Yours" : t.assignees.length ? t.assignees.join(", ") : "Not assigned"}
              {t.deadline ? ` · due ${t.deadline}` : ""}
            </p>
          </div>
          <div className="flex gap-2 text-xs">
            {t.priority ? <span className="rounded-full bg-bg px-2.5 py-0.5 font-semibold">{t.priority}</span> : null}
            {t.status ? <span className="rounded-full bg-bg px-2.5 py-0.5">{t.status}</span> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---- Peek's own tasks ---------------------------------------------------------------------------

type PeekTask = TaskRow & { source: "peek" };

function PeekTasks({ tasks, people, canRelease, focus }: { tasks: TaskRow[]; people: string[]; canRelease: boolean; focus: { id: string; status: string } | null }) {
  const [list, setList] = useState(tasks as PeekTask[]);
  // a link to a task that is no longer open (Done, Not Fisible, Dublicate) says so instead of showing nothing
  const closed = focus && !list.some((t) => t.pageId === focus.id) ? (
    <p role="status" className="mt-4 rounded-xl border border-line bg-panel p-4 text-sm">
      The task in that link is {focus.status ? <b>{focus.status}</b> : "closed"}, so it is no longer in the queue.
    </p>
  ) : null;
  if (!list.length)
    return (
      <>
        {closed}
        <p className="mt-6 rounded-xl bg-panel p-4 text-sm text-muted">No open tasks. Nice.</p>
      </>
    );
  return (
    <>
    {closed}
    <ul className="mt-4 space-y-3">
      {list.map((t) => (
        <TaskCard
          key={t.pageId}
          task={t}
          people={people}
          canRelease={canRelease}
          focused={focus?.id === t.pageId}
          onChange={(next) => setList((l) => (next ? l.map((x) => (x.pageId === t.pageId ? next : x)) : l.filter((x) => x.pageId !== t.pageId)))}
        />
      ))}
    </ul>
    </>
  );
}

const pill = "inline-flex min-h-8 items-center gap-1 rounded-full px-3 text-xs";
/** A pill you press: 44 px tall, 14 px text. */
const tap = "inline-flex min-h-11 items-center gap-1 rounded-full px-4 text-sm";

function TaskCard({ task: t, people, canRelease, focused = false, onChange }: { task: PeekTask; people: string[]; canRelease: boolean; focused?: boolean; onChange: (t: PeekTask | null) => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(focused);
  const card = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (focused) card.current?.scrollIntoView({ block: "center" });
  }, [focused]);
  const done = (t.checklist ?? []).filter((c) => c.done).length;
  const patch = async (what: string, change: object) => {
    setBusy(what);
    setError("");
    const res = await fetch(`/api/tasks/${t.pageId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(change) }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string; task?: Record<string, unknown> } | null;
    setBusy("");
    if (!body?.ok || !body.task) return setError(body?.error ?? "No answer; try again.");
    const n = body.task;
    const status = String(n.status ?? "");
    // Done (or closed another way) leaves the queue; the standing task never does.
    if (["Done", "Not Fisible", "Dublicate"].includes(status) && !t.standing) return onChange(null);
    onChange({ ...t, status, assignees: (n.assignees as string[] | null) ?? [], checklist: (n.checklist as PeekTask["checklist"]) ?? [], priority: String(n.priority ?? ""), deadline: String(n.due ?? "") });
  };
  const claim = async (action: "accept" | "release") => {
    setBusy(action);
    setError("");
    const res = await fetch("/api/queue/claim", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pageId: t.pageId, action }) }).catch(() => null);
    const body = (await res?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    setBusy("");
    if (!body?.ok) return setError(body?.error ?? "No answer; try again.");
    onChange({ ...t, takenBy: action === "accept" ? { name: "you", mine: true } : null });
  };
  const unassigned = people.filter((p) => !t.assignees.includes(p));
  return (
    <li ref={card} aria-current={focused || undefined} className={`rounded-xl border bg-panel ${t.standing ? "border-accent" : "border-line"} ${focused ? "ring-2 ring-accent" : ""}`}>
      <Busy busy={!!busy} className="rounded-xl p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-semibold">
              {t.standing ? <span className="mr-2 rounded-full bg-accent-tint px-2 py-0.5 text-xs font-semibold text-accent-ink">Pinned · standing</span> : null}
              {t.task}
            </h2>
            <p className="text-xs text-muted">
              {t.uid ? `${t.uid} · ` : ""}
              {t.takenBy ? (t.takenBy.mine ? "You are on it" : `${t.takenBy.name} is on it`) : "Nobody on it yet"}
              {t.url ? (
                <>
                  {" · "}
                  <a href={t.url} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">
                    Notion page
                  </a>
                </>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={t.priority}
              disabled={!!busy}
              onChange={(e) => void patch("priority", { priority: e.target.value || null })}
              aria-label="Priority"
              className={`${tap} border border-line bg-bg font-semibold`}
            >
              <option value="">No priority</option>
              {["P0", "P1", "P2", "P3", "P4", "P5", "P6", "Medium"].map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
            <label className={`${tap} border border-line bg-bg`}>
              Due
              <input type="date" value={t.deadline} disabled={!!busy} onChange={(e) => void patch("due", { due: e.target.value || null })} aria-label="Deadline" className="bg-transparent text-sm" />
            </label>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1" role="group" aria-label="Status">
          {/* the standing task is never done: it has no Done step */}
          {STEPS.filter((s) => !(t.standing && s === "Done")).map((s, i) => {
            const at = STEPS.indexOf(t.status as (typeof STEPS)[number]);
            const on = s === t.status;
            return (
              <button
                key={s}
                type="button"
                disabled={!!busy || on}
                aria-pressed={on}
                onClick={() => void patch("status", { status: s })}
                className={`${tap} border ${on ? "border-accent bg-accent font-semibold text-on-accent" : i < at ? "border-accent/40 text-accent-ink" : "border-line hover:border-accent"}`}
              >
                {s}
              </button>
            );
          })}
          {!STEPS.includes(t.status as (typeof STEPS)[number]) && t.status ? <span className={`${pill} border border-bad text-bad`}>{t.status}</span> : null}
          {t.status && t.status !== "Not started" ? (
            <button type="button" disabled={!!busy} onClick={() => void patch("status", { status: "" })} aria-label="Clear the status (back to Not started)" title="Back to Not started" className={`${tap} text-muted hover:text-bad`}>
              ×
            </button>
          ) : null}
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          {t.assignees.length ? null : <span className="text-muted">Not assigned</span>}
          {t.assignees.map((a) => (
            <span key={a} className={`${tap} bg-bg pr-1`}>
              {a}
              <button type="button" disabled={!!busy} onClick={() => void patch("assignees", { assignees: t.assignees.filter((x) => x !== a) })} aria-label={`Unassign ${a}`} className="inline-flex size-9 items-center justify-center rounded-full text-base text-muted hover:bg-panel hover:text-bad">
                ×
              </button>
            </span>
          ))}
          {unassigned.length ? (
            <select value="" disabled={!!busy} onChange={(e) => e.target.value && void patch("assignees", { assignees: [...t.assignees, e.target.value] })} aria-label="Assign someone" className={`${tap} border border-dashed border-line bg-transparent`}>
              <option value="">+ Assign</option>
              {unassigned.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          ) : null}
        </div>

        {t.checklist?.length ? (
          <div className="mt-3">
            <p className="text-xs text-muted">
              Done when · {done} of {t.checklist.length}
            </p>
            <ul className="mt-1 space-y-0.5">
              {t.checklist.map((c, i) => (
                <li key={`${i}-${c.text}`}>
                  <label className="flex min-h-9 items-start gap-2 text-sm">
                    <input type="checkbox" checked={c.done} disabled={!!busy} onChange={(e) => void patch("tick", { tick: { index: i, text: c.text, done: e.target.checked } })} className="mt-0.5 size-5 shrink-0 accent-[#ff6600]" />
                    <span className={c.done ? "text-muted line-through" : ""}>{c.text}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {t.flags?.length ? (
          <ul className="mt-3 space-y-1 text-xs">
            {t.flags.map((f) => (
              <li key={f.rule} className="rounded-lg bg-bg px-3 py-1.5">
                <span className="font-semibold text-bad">{f.rule}</span> {f.detail}
              </li>
            ))}
          </ul>
        ) : null}

        {t.details ? (
          <>
            <button type="button" onClick={() => setOpen((o) => !o)} className="mt-2 inline-flex min-h-11 items-center text-sm text-muted hover:text-accent">
              {open ? "Hide the details" : "Show the details"}
            </button>
            {open ? <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-bg p-3 font-sans text-sm whitespace-pre-wrap">{t.details}</pre> : null}
          </>
        ) : null}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!t.takenBy ? (
            <PendingButton variant="quiet" pending={busy === "accept"} disabled={!!busy} onClick={() => void claim("accept")}>
              I&apos;m on it
            </PendingButton>
          ) : null}
          {t.takenBy?.mine || (t.takenBy && canRelease) ? (
            <PendingButton variant="link" disabled={!!busy} onClick={() => void claim("release")} className="text-muted">
              Release
            </PendingButton>
          ) : null}
          {error ? <span className="text-xs text-bad">{error}</span> : null}
        </div>
      </Busy>
    </li>
  );
}

function Card(p: { row: Row; rank: number; status: string; canRelease: boolean; onMarked: (s: string) => void; onTaken: (t: Taken) => void; reload: () => void }) {
  const { row, rank, status } = p;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(rank <= 3);
  const mine = !!row.takenBy?.mine;
  // The list carries the drafts' first characters; the full text is read once, when the card is opened or copied.
  const [full, setFull] = useState<{ draft: string; whatsappDraft: string } | null>(row.draftCut ? null : { draft: row.draft, whatsappDraft: row.whatsappDraft });
  const [draftError, setDraftError] = useState(false);
  // Never the preview in place of the draft: if the full text cannot be read, say so (with Retry) and copy nothing.
  const loadFull = useCallback(async () => {
    if (full) return full;
    setDraftError(false);
    const res = await fetch(`/api/queue/draft?pageId=${row.pageId}`).catch(() => null);
    const r = res?.ok ? ((await res.json().catch(() => null)) as { draft?: string; whatsappDraft?: string } | null) : null;
    if (!r || typeof r.draft !== "string") {
      setDraftError(true);
      throw new Error("draft not loaded");
    }
    const got = { draft: r.draft, whatsappDraft: r.whatsappDraft ?? "" };
    setFull(got);
    return got;
  }, [full, row.pageId]);
  useEffect(() => {
    if (!open || full || draftError) return;
    const t = setTimeout(() => void loadFull().catch(() => {}), 0);
    return () => clearTimeout(t);
  }, [open, full, draftError, loadFull]);
  const post = async (url: string, payload: object) => {
    setBusy(true);
    setError("");
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pageId: row.pageId, ...payload }) });
    const body = (await res.json().catch(() => ({}))) as { ok?: boolean; status?: string; error?: string };
    setBusy(false);
    if (!body.ok) setError(body.error ?? `HTTP ${res.status}`);
    // Someone else got there first: show the queue as it is now.
    if (res.status === 409) p.reload();
    return body;
  };
  // A mark moves the card (to Send email, or out of the queue), so it waits for Notion's read-back with a spinner on the
  // button pressed; if Notion does not take it, the card stays and says why.
  const [which, setWhich] = useState("");
  const mark = async (s: string) => {
    setWhich(s);
    const body = await post("/api/queue", { status: s });
    setWhich("");
    if (body.ok && body.status) p.onMarked(body.status);
    else setError(`${body.error ?? "Notion did not take it"}. Nothing changed; try again.`);
  };
  const acceptIt = async () => {
    if ((await post("/api/queue/claim", { action: "accept" })).ok) p.onTaken({ name: "you", mine: true, at: new Date().toISOString() });
  };
  const releaseIt = async () => {
    if ((await post("/api/queue/claim", { action: "release" })).ok) p.onTaken(null);
  };
  return (
    <li className="rounded-xl border border-line bg-panel">
      <Busy busy={busy} className="rounded-xl p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">
            <span className="mr-2 text-sm text-muted tabular-nums">{rank}.</span>
            {row.business}
          </h2>
          <p className="text-sm text-muted">
            {row.contact ? `${row.contact}${row.role ? `, ${row.role}` : ""}` : "No contact person yet"}
            {row.website ? (
              <>
                {" · "}
                <a href={row.website} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">site</a>
              </>
            ) : null}
            {row.url ? (
              <>
                {" · "}
                <a href={row.url} target="_blank" rel="noreferrer" className="text-accent-ink hover:underline">Notion row</a>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex gap-2 text-xs">
          {row.score !== null ? <span className="rounded-full bg-bg px-2.5 py-0.5 font-semibold tabular-nums">score {row.score}</span> : null}
          {status ? <span className="rounded-full bg-bg px-2.5 py-0.5">{status}</span> : null}
          {mine ? <span className="rounded-full bg-accent-tint px-2.5 py-0.5 font-semibold text-accent-ink">Yours</span> : null}
          {row.takenBy && !mine ? <span className="rounded-full border border-line px-2.5 py-0.5">Taken by {row.takenBy.name}</span> : null}
        </div>
      </div>
      {mine ? (
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {row.email ? (
          <>
            <span className="font-mono text-xs">{row.email}</span>
            <CopyChip label="Copy address" text={row.email} />
          </>
        ) : (
          <span className="text-xs text-muted">No business email: WhatsApp only</span>
        )}
        <CopyChip label="Copy draft" text={async () => (await loadFull()).draft} />
        {row.whatsapp && row.whatsappDraft ? (
          <>
            <a href={row.whatsapp} target="_blank" rel="noreferrer" className="text-xs text-accent-ink hover:underline">WhatsApp</a>
            <CopyChip label="Copy WhatsApp draft" text={async () => (await loadFull()).whatsappDraft} />
          </>
        ) : null}
      </div>
      ) : null}
      <button onClick={() => setOpen((o) => !o)} className="mt-2 inline-flex min-h-11 items-center text-sm text-muted hover:text-accent">
        {open ? "Hide the draft" : "Show the draft"}
      </button>
      {open ? (
        full ? (
          <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-bg p-3 font-sans text-sm whitespace-pre-wrap">{full.draft}</pre>
        ) : draftError ? (
          <p className="mt-2 rounded-lg bg-bg p-3 text-sm text-bad">
            The full draft could not be read.{" "}
            <button type="button" onClick={() => void loadFull().catch(() => {})} className="underline">
              Retry
            </button>
          </p>
        ) : (
          <div aria-busy="true" className="mt-2 animate-pulse space-y-2 rounded-lg bg-bg p-3">
            <div className="h-3 w-11/12 rounded bg-line" />
            <div className="h-3 w-10/12 rounded bg-line" />
            <div className="h-3 w-9/12 rounded bg-line" />
            <span className="sr-only">Loading the draft…</span>
          </div>
        )
      ) : (
        <p className="mt-2 truncate text-sm text-muted italic" title="Preview: open the card for the full draft">
          {row.draft.split("\n")[0]}…
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!row.takenBy ? (
          <PendingButton pending={busy} pendingLabel="Accepting…" onClick={() => void acceptIt()}>
            Accept
          </PendingButton>
        ) : null}
        {mine ? (
          <>
            <PendingButton pending={which === "Email Sent"} disabled={busy} onClick={() => void mark("Email Sent")}>
              I sent it
            </PendingButton>
            {status !== "Ready to Send Email" ? (
              <PendingButton variant="quiet" pending={which === "Ready to Send Email"} disabled={busy} onClick={() => void mark("Ready to Send Email")}>
                Reviewed, ready to send
              </PendingButton>
            ) : null}
          </>
        ) : null}
        {mine || (row.takenBy && p.canRelease) ? (
          <PendingButton variant="link" disabled={busy} onClick={() => void releaseIt()} className="text-muted">
            Release
          </PendingButton>
        ) : null}
        {error ? <span className="text-xs text-bad">{error}</span> : null}
      </div>
      </Busy>
    </li>
  );
}
