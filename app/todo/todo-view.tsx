"use client";
// The To-do page: the team's open tasks, the standing task first, then yours, then the rest by priority. A bot's link to
// a task (<portal>/tasks/<id> -> /todo?task=<id>&status=) opens that task's card and brings it into view; a link to a closed one
// says so. The leads' review and send work lives on the Leads page (Send next).
import { useCallback, useEffect, useRef, useState } from "react";
import type { TaskRow } from "@/lib/queue";
import { STEPS } from "@/lib/task-steps";
import { Busy, PendingButton } from "../ui";

type Feed = { ok: boolean; reason?: string; canRelease?: boolean; tasks?: TaskRow[]; tasksReason?: string; people?: string[] };

export default function TodoView() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [focus, setFocus] = useState<{ id: string; status: string } | null>(null);
  const load = useCallback(async () => {
    const res = await fetch("/api/queue", { cache: "no-store" });
    setFeed((await res.json()) as Feed);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      const sp = new URLSearchParams(location.search);
      if (sp.get("task")) setFocus({ id: sp.get("task")!, status: sp.get("status") ?? "" });
      void load();
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  return (
    <div>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">To-do</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">The team&apos;s open tasks: the standing task first, then yours, then the rest by priority. Take one before you start it, so two people never do the same work.</p>
        </div>
        <button onClick={() => void load()} className="inline-flex min-h-11 items-center text-sm text-accent-ink hover:underline">
          Refresh
        </button>
      </div>
      {!feed ? <p className="mt-6 text-sm text-muted">Reading the tasks…</p> : null}
      {feed && !feed.ok ? <p className="mt-6 rounded-xl bg-panel p-4 text-sm text-muted">{feed.reason}</p> : null}
      {feed?.ok ? (
        feed.tasksReason ? (
          <p className="mt-6 rounded-xl bg-panel p-4 text-sm text-muted">{feed.tasksReason}</p>
        ) : (
          <PeekTasks tasks={feed.tasks ?? []} people={feed.people ?? []} canRelease={!!feed.canRelease} focus={focus} />
        )
      ) : null}
    </div>
  );
}

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
