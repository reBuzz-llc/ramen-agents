"use client";

import { useCallback, useEffect, useState } from "react";
import { defaultProject, dropdownOptions } from "@/lib/project-picker";
import { hhmm } from "@/lib/timesheet";
import { labelText } from "@/lib/ui-classes";
import { Busy, Spinner } from "../ui";

type Shift = { id: string; startedAt: string; endedAt: string | null; minutes: number; open: boolean; note: string; projectId: string | null; notes: { id: string; at: string; text: string }[]; updates: { expected: number; met: number } };
type Gap = { from: string; to: string; minutes: number; note: string };
type Project = { id: string; name: string; client: string; active: boolean };
type Day = {
  shifts: Shift[];
  workedMinutes: number;
  gaps: Gap[];
  projects: Project[];
  recent: (string | null)[];
  lastNotes: Record<string, string>;
  canDeleteAny: boolean;
  update: { cadence: number; dueAt: string | null; postedThisWindow: boolean; overdueSince: string | null } | null;
  byProject: { id: string | null; name: string; minutes: number }[];
  lastProjectId: string | null;
};

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const NEW = "__new";
const GENERAL = "";
// One primary action at a time, in the brand colour; everything else is an outline or a text button.
const primary =
  "inline-flex h-11 min-w-36 items-center justify-center gap-2 rounded-full bg-accent px-6 text-base font-semibold text-on-accent hover:bg-accent-hover active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
const outline = "inline-flex h-11 items-center justify-center rounded-full border border-line bg-panel px-4 text-sm hover:border-accent active:bg-accent-tint disabled:cursor-not-allowed disabled:opacity-50";
const field = "h-11 w-full rounded-xl border border-line bg-panel px-3 text-base disabled:opacity-50";

/** The project dropdown: recent first, then every open project, General, and "+ New project…" at the end. */
function ProjectSelect(p: { id: string; projects: Project[]; recent: (string | null)[]; value: string; onChange: (v: string) => void; disabled?: boolean; label: string }) {
  const { recent: r, rest } = dropdownOptions(p.projects, p.recent);
  const opt = (o: { id: string | null; name: string; client: string }) => (
    <option key={o.id ?? "general"} value={o.id ?? GENERAL}>
      {o.name}
      {o.client ? ` · ${o.client}` : ""}
    </option>
  );
  return (
    <div>
      <label htmlFor={p.id} className={`block ${labelText}`}>
        {p.label}
      </label>
      <select id={p.id} value={p.value} disabled={p.disabled} onChange={(e) => p.onChange(e.target.value)} className={`mt-1 ${field}`}>
        {r.length ? <optgroup label="Recent">{r.map(opt)}</optgroup> : null}
        <optgroup label={r.length ? "All projects" : "Projects"}>{rest.map(opt)}</optgroup>
        <option value={NEW}>+ New project…</option>
      </select>
    </div>
  );
}

/** The clock (the home page): clock in to a project and out, a running timer, switch project, today's shifts with their
 * project fixable, and a note on any gap. Only time is recorded: no screenshots, no keystrokes, nothing from your computer. */
export default function ClockView() {
  const [dayData, setDay] = useState<Day | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const [newName, setNewName] = useState("");
  const [closing, setClosing] = useState(false);
  const [outNote, setOutNote] = useState("");
  const [updating, setUpdating] = useState(false);
  const [update, setUpdate] = useState("");
  const [toast, setToast] = useState("");
  const load = useCallback(async () => setDay((await (await fetch("/api/clock", { cache: "no-store" })).json()) as Day), []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const refresh = setInterval(() => void load(), 60000);
    return () => {
      clearTimeout(t);
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [load]);
  const say = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(""), 6000);
  };
  const [pending, setPending] = useState(false);
  const post = async (payload: object) => {
    if (pending) return false;
    setError("");
    setPending(true);
    const res = await fetch("/api/clock", {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() },
      body: JSON.stringify(payload),
    })
      .catch(() => null)
      .finally(() => setPending(false));
    if (!res) {
      setError("No answer from the server; check the connection and try again.");
      return false;
    }
    const body = await res.json().catch(() => ({}));
    if (res.ok) setDay(body as Day);
    else setError((body as { error?: string }).error ?? `HTTP ${res.status}`);
    return res.ok;
  };
  const open = dayData?.shifts.find((s) => s.open);
  const running = open ? Math.floor((now - new Date(open.startedAt).getTime()) / 1000) : 0;
  const closed = (dayData?.shifts ?? []).filter((s) => !s.open).reduce((t, s) => t + s.minutes, 0);
  const projects = dayData?.projects ?? [];
  const making = picked === NEW;
  const choice = defaultProject({ clockedIn: !!open, openProjectId: open?.projectId, picked: making ? undefined : picked, last: dayData?.lastProjectId ?? null, projects });
  const nameOf = (id: string | null) => (id ? (projects.find((p) => p.id === id)?.name ?? "(removed project)") : "General");
  const u = dayData?.update && dayData.update.cadence && dayData.update.dueAt ? dayData.update : null;
  const dueIn = u?.dueAt ? Math.ceil((new Date(u.dueAt).getTime() - now) / 60000) : 0;
  const overdueSince = u ? (u.overdueSince ?? (!u.postedThisWindow && dueIn <= 0 ? u.dueAt : null)) : null;
  const clock = `${String(Math.floor(running / 3600)).padStart(2, "0")}:${String(Math.floor((running % 3600) / 60)).padStart(2, "0")}:${String(running % 60).padStart(2, "0")}`;
  const at = () => time(new Date().toISOString());

  const clockIn = async () => {
    if (making && !newName.trim()) return setError("Name the new project first.");
    const name = making ? newName.trim() : nameOf(choice);
    if (await post(making ? { action: "in", newProject: newName.trim() } : { action: "in", projectId: choice })) {
      say(`Clocked in on ${name} at ${at()}.`);
      setPicked(undefined);
      setNewName("");
    }
  };
  const clockOut = async () => {
    const summary = `${hhmm(Math.floor(running / 60))} on ${nameOf(open?.projectId ?? null)}`;
    if (await post({ action: "out", note: outNote.trim() })) {
      say(`Clocked out at ${at()}: ${summary}.`);
      setClosing(false);
      setOutNote("");
    }
  };
  const switchTo = async (v: string) => {
    if (v === NEW) return setPicked(NEW);
    const was = `${hhmm(Math.floor(running / 60))} stays on ${nameOf(open?.projectId ?? null)}`;
    if (await post({ action: "switch", projectId: v || null })) say(`Switched to ${nameOf(v || null)} at ${at()}; ${was}.`);
  };
  const switchToNew = async () => {
    const name = newName.trim();
    if (!name) return;
    if (await post({ action: "switch", newProject: name })) {
      setPicked(undefined);
      setNewName("");
      say(`Switched to ${name} at ${at()}.`);
    }
  };
  const postUpdate = async () => {
    if (!update.trim()) return;
    if (await post({ action: "now", text: update })) {
      setUpdate("");
      setUpdating(false);
      say("Update posted.");
    }
  };

  return (
    <div className="max-w-xl">
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Clock</h1>
      <p className="mt-1 text-sm text-muted">Clock in to a project and out. Only the times, the project and your notes are recorded: no screenshots, no keystrokes.</p>

      <Busy busy={pending} className="mt-6 rounded-2xl border border-line bg-panel p-5">
        {!dayData ? (
          <div aria-busy="true" className="animate-pulse space-y-3">
            <div className="h-12 w-48 rounded-lg bg-bg" />
            <div className="h-11 rounded-xl bg-bg" />
            <span className="sr-only">Loading…</span>
          </div>
        ) : open ? (
          <>
            <p className="text-sm text-muted">
              Clocked in on {nameOf(open.projectId)} since {time(open.startedAt)}
            </p>
            <p className="mt-1 text-5xl font-semibold tracking-tight tabular-nums">{clock}</p>
            <p className="mt-1 text-sm text-muted">Today {hhmm(closed + Math.floor(running / 60))}</p>
            {closing ? (
              <form
                className="mt-5 space-y-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  void clockOut();
                }}
              >
                <label htmlFor="out-note" className={`block ${labelText}`}>
                  What did you get done? (optional; your team sees it)
                </label>
                <textarea id="out-note" value={outNote} onChange={(e) => setOutNote(e.target.value)} maxLength={500} rows={3} className="w-full rounded-xl border border-line bg-bg px-3 py-2 text-base" />
                <div className="flex flex-wrap items-center gap-3">
                  <button type="submit" disabled={pending} className={primary}>
                    {pending ? <Spinner /> : null}
                    Clock out
                  </button>
                  <button type="button" onClick={() => setClosing(false)} className="min-h-11 px-2 text-sm text-muted hover:text-ink">
                    Keep working
                  </button>
                </div>
              </form>
            ) : (
              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button type="button" onClick={() => setClosing(true)} disabled={pending} className={primary}>
                  Clock out
                </button>
                <button type="button" onClick={() => setUpdating(!updating)} className="min-h-11 px-2 text-sm text-accent-ink hover:underline">
                  Post an update
                </button>
              </div>
            )}
            {updating && !closing ? (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void postUpdate();
                }}
              >
                <input value={update} onChange={(e) => setUpdate(e.target.value)} maxLength={280} placeholder="Now doing…" aria-label="Update" className={field} />
                <button disabled={!update.trim() || pending} className={outline}>
                  Post
                </button>
              </form>
            ) : null}
            {u ? (
              overdueSince ? (
                <p role="status" className="mt-3 rounded-lg border border-accent bg-bg px-3 py-2 text-sm">
                  An update is due (since {time(overdueSince)}): press &quot;Post an update&quot;. It is a reminder for the client&apos;s log; nothing is deducted.
                </p>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  {u.postedThisWindow ? `Update posted; the next is due by ${time(new Date(new Date(u.dueAt!).getTime() + u.cadence * 60000).toISOString())}` : `Next update due by ${time(u.dueAt!)} (in ${Math.max(1, dueIn)} min)`}
                  {" · "}this project asks for one {u.cadence === 60 ? "every hour" : `every ${u.cadence} minutes`}.
                </p>
              )
            ) : null}
            <div className="mt-5 border-t border-line pt-4">
              <ProjectSelect
                id="switch"
                label="Switch project (ends this shift, starts another now)"
                projects={projects}
                recent={dayData.recent}
                value={making ? NEW : (open.projectId ?? GENERAL)}
                disabled={pending}
                onChange={(v) => void switchTo(v)}
              />
              {making ? (
                <form
                  className="mt-2 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void switchToNew();
                  }}
                >
                  <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} placeholder="New project's name" aria-label="New project's name" className={field} />
                  <button disabled={!newName.trim() || pending} className={outline}>
                    Create and switch
                  </button>
                </form>
              ) : null}
            </div>
            {u ? <OverdueNotice overdue={!!overdueSince} /> : null}
          </>
        ) : (
          <>
            <p className="text-sm text-muted">Not clocked in · today {hhmm(closed)}</p>
            <div className="mt-4">
              <ProjectSelect id="project" label="Project" projects={projects} recent={dayData.recent} value={making ? NEW : (choice ?? GENERAL)} disabled={pending} onChange={(v) => setPicked(v === NEW ? NEW : v || null)} />
              {making ? <input value={newName} onChange={(e) => setNewName(e.target.value)} maxLength={80} placeholder="New project's name" aria-label="New project's name" className={`mt-2 ${field}`} /> : null}
            </div>
            <button type="button" onClick={() => void clockIn()} disabled={pending || (making && !newName.trim())} className={`mt-4 ${primary}`}>
              {pending ? <Spinner /> : null}
              Clock in
            </button>
          </>
        )}
        {error ? (
          <p role="alert" className="mt-3 text-sm text-bad">
            {error}
          </p>
        ) : null}
      </Busy>
      {toast ? (
        <p role="status" className="mt-3 rounded-lg bg-good/10 px-3 py-2 text-sm text-good">
          {toast}
        </p>
      ) : null}

      <h2 className="mt-8 text-base font-semibold">Today</h2>
      {dayData && !dayData.shifts.length ? <p className="mt-2 text-sm text-muted">No shifts yet today. Pick a project and press Clock in.</p> : null}
      <ul className="mt-2 divide-y divide-line">
        {(dayData?.shifts ?? []).map((s) => (
          <ShiftRow key={s.id} s={s} projects={projects} nameOf={nameOf} now={now} canDeleteAny={!!dayData?.canDeleteAny} pending={pending} post={post} />
        ))}
      </ul>

      {dayData && dayData.byProject.length > 1 ? (
        <>
          <h2 className="mt-8 text-base font-semibold">By project</h2>
          <ul className="mt-2 divide-y divide-line">
            {dayData.byProject.map((p) => (
              <li key={p.id ?? "general"} className="flex justify-between py-2 text-sm tabular-nums">
                <a href={`/projects/${p.id ?? "general"}`} className="inline-flex min-h-11 items-center hover:text-accent">
                  {p.name}
                </a>
                <span className="text-muted">{hhmm(p.minutes)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {dayData?.gaps.length ? (
        <>
          <h2 className="mt-8 text-base font-semibold">Gaps</h2>
          <p className="text-sm text-muted">Time between your shifts. A note helps when you look back (lunch, a call away from the laptop).</p>
          <ul className="mt-2 space-y-2">
            {dayData.gaps.map((g) => (
              <GapRow key={g.from} gap={g} onSave={(note) => void post({ action: "note", from: g.from, to: g.to, note })} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** One shift of today: times, project and length; Edit fixes the project (times are not edited here). */
function ShiftRow(p: { s: Shift; projects: Project[]; nameOf: (id: string | null) => string; now: number; canDeleteAny: boolean; pending: boolean; post: (b: object) => Promise<boolean> }) {
  const { s } = p;
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(s.projectId ?? GENERAL);
  return (
    <li className="py-2 text-sm">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 tabular-nums">
        <span>
          {time(s.startedAt)} – {s.endedAt ? time(s.endedAt) : "now"} <span className="text-muted">· {p.nameOf(s.projectId)}</span>
        </span>
        <span className="flex items-center gap-3">
          <span className="text-muted">{hhmm(s.minutes)}</span>
          {!s.open ? (
            <button type="button" onClick={() => setEditing(!editing)} className="min-h-11 px-1 text-accent-ink hover:underline">
              {editing ? "Cancel" : "Edit"}
            </button>
          ) : null}
        </span>
      </div>
      {editing ? (
        <form
          className="mt-1 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void p.post({ action: "shiftProject", shiftId: s.id, projectId: value || null }).then((ok) => ok && setEditing(false));
          }}
        >
          <div className="min-w-56 flex-1">
            <label htmlFor={`sp-${s.id}`} className={`block ${labelText}`}>
              Project for this shift
            </label>
            <select id={`sp-${s.id}`} value={value} onChange={(e) => setValue(e.target.value)} className={`mt-1 ${field}`}>
              {[{ id: null as string | null, name: "General" }, ...p.projects.filter((x) => x.active)].map((o) => (
                <option key={o.id ?? "general"} value={o.id ?? GENERAL}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
          <button disabled={p.pending || value === (s.projectId ?? GENERAL)} className={outline}>
            Save
          </button>
        </form>
      ) : null}
      {s.updates.expected ? (
        <p className="pl-3 text-sm text-muted">
          {s.updates.met} of {s.updates.expected} updates
        </p>
      ) : null}
      {s.note ? <p className="pl-3 text-sm text-muted">Done: {s.note}</p> : null}
      {s.notes.length ? (
        <ul className="mt-1 space-y-0.5 pl-3 text-sm text-muted">
          {s.notes.map((n) => (
            <li key={n.id} className="flex items-baseline gap-2">
              <span>
                <span className="tabular-nums">{time(n.at)}</span> {n.text}
              </span>
              {p.canDeleteAny || p.now - new Date(n.at).getTime() < 10 * 60_000 ? (
                <button type="button" disabled={p.pending} onClick={() => void p.post({ action: "deleteNote", noteId: n.id })} className="text-accent-ink hover:underline disabled:opacity-40">
                  delete
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function GapRow({ gap, onSave }: { gap: Gap; onSave: (note: string) => void }) {
  const [note, setNote] = useState(gap.note);
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted tabular-nums">
        {time(gap.from)} – {time(gap.to)} ({hhmm(gap.minutes)})
      </span>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="what this was (optional)" aria-label="What this gap was" className="h-11 w-full min-w-0 rounded-xl border border-line bg-panel px-3 text-sm sm:h-10 sm:w-auto sm:flex-1" />
      <button
        onClick={() => onSave(note)}
        disabled={!note.trim() || note === gap.note}
        className="inline-flex h-10 items-center rounded-full border border-line px-4 text-sm hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
      >
        Save
      </button>
    </li>
  );
}

/** A browser notification when an update becomes due, if the person allowed it; one button to allow it. */
function OverdueNotice({ overdue }: { overdue: boolean }) {
  const [perm, setPerm] = useState<string>(() => (typeof Notification === "undefined" ? "unsupported" : Notification.permission));
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (!overdue) {
      const t = setTimeout(() => setSent(false), 0);
      return () => clearTimeout(t);
    }
    if (sent || perm !== "granted") return;
    new Notification("ramen-agents: an update is due", { body: "Post what you are working on, for the client's log." });
    const t = setTimeout(() => setSent(true), 0);
    return () => clearTimeout(t);
  }, [overdue, sent, perm]);
  if (perm !== "default") return null;
  return (
    <button type="button" onClick={() => void Notification.requestPermission().then(setPerm)} className="mt-3 min-h-11 text-sm text-accent-ink hover:underline">
      Remind me with a browser notification when an update is due
    </button>
  );
}
