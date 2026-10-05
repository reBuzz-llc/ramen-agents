"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BotProfile } from "@/lib/bot";
import { sendJson } from "@/lib/client";
import type { Member, NotionUser, TeamDoc } from "@/lib/team";
import { useLeaveGuard } from "./hooks";
import Sheet from "./sheet";
import { buttonClass, Icon, Spinner } from "./ui";

type Loaded = { enabled: boolean; team: TeamDoc; users: NotionUser[]; notionError: string | null };

const field = "w-full rounded-lg bg-fill-3 px-3 py-2 text-sm text-ink placeholder:text-muted focus:ring-2 focus:ring-sys-blue/40 focus:outline-none";

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
}

function Avatar({ name, src }: { name: string; src?: string | null }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
  ) : (
    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-sys-blue/15 text-xs font-bold text-info">{initials(name) || "?"}</span>
  );
}

/** The people this bot may assign Notion tasks to: picked from the workspace, described by the owner.
 * Shown on the Persona page of a bot with the Notion skill; the list is shared by every such bot. */
export default function TeamPanel({ bot }: { bot: BotProfile }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [saved, setSaved] = useState<Member[]>([]);
  const [pick, setPick] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [editing, setEditing] = useState(false);

  const load = useCallback(
    (refresh = false) =>
      fetch(`/api/team?bot=${bot.slug}${refresh ? "&refresh=1" : ""}`, { cache: "no-store" })
        .then(async (res) => {
          const body = (await res.json()) as Loaded & { error?: string };
          if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
          setLoaded(body);
          setLoadError(null);
          // A refresh only re-reads the Notion users for the picker: members being edited stay as they are.
          if (!refresh) {
            setMembers(body.team.members);
            setSaved(body.team.members);
          }
        })
        .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : "request failed")),
    [bot.slug],
  );
  useEffect(() => {
    let live = true;
    fetch(`/api/team?bot=${bot.slug}`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json()) as Loaded & { error?: string };
        if (!live) return;
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
        setLoaded(body);
        setMembers(body.team.members);
        setSaved(body.team.members);
      })
      .catch((err: unknown) => live && setLoadError(err instanceof Error ? err.message : "request failed"));
    return () => {
      live = false;
    };
  }, [bot.slug]);

  const dirty = useMemo(() => JSON.stringify(members) !== JSON.stringify(saved), [members, saved]);
  const available = useMemo(() => (loaded?.users ?? []).filter((u) => !members.some((m) => m.notionId === u.id)), [loaded, members]);

  useLeaveGuard(dirty, "You have unsaved team changes. Leave this page and lose them?");

  if (loaded && !loaded.enabled) return null;

  function add() {
    const u = available.find((x) => x.id === pick) ?? available[0];
    if (!u) return;
    setMembers((m) => [...m, { notionId: u.id, name: u.name, email: u.email, role: "", details: "", default: m.length === 0, avatar: u.avatar }]);
    setPick("");
    setNotice(null);
  }

  function update(id: string, patch: Partial<Member>) {
    setMembers((m) => m.map((x) => (x.notionId === id ? { ...x, ...patch } : x)));
  }

  function remove(id: string) {
    setMembers((m) => {
      const rest = m.filter((x) => x.notionId !== id);
      if (rest.length && !rest.some((x) => x.default)) rest[0] = { ...rest[0], default: true };
      return rest;
    });
  }

  async function save() {
    setSaving(true);
    setNotice(null);
    const sent = await sendJson<{ team?: TeamDoc; error?: string; notionError?: string | null }>("/api/team", "PUT", { bot: bot.slug, members });
    if (sent.body?.team) {
      setMembers(sent.body.team.members);
      setSaved(sent.body.team.members);
      const dropped = members.length - sent.body.team.members.length;
      setNotice({ tone: "good", text: dropped > 0 ? `Saved. ${dropped} ${dropped === 1 ? "person" : "people"} not in the Notion workspace ${dropped === 1 ? "was" : "were"} left out.` : `Saved. ${bot.name} uses it from its next episode; no restart needed.` });
    } else setNotice({ tone: "bad", text: sent.body?.error ?? sent.error ?? "request failed" });
    setSaving(false);
  }

  const editor = !loaded ? null : (
    <div className="space-y-4">
      {notice ? (
        <p role="status" className={`rounded-lg px-3 py-2 text-sm ${notice.tone === "bad" ? "bg-sys-red/10 text-bad" : "bg-sys-green/12 text-ink"}`}>
          {notice.text}
        </p>
      ) : null}

      {members.length ? (
        <ul className="max-h-[50vh] space-y-3 overflow-y-auto">
          {members.map((m) => (
            <li key={m.notionId} className="rounded-xl bg-grouped-3 p-3">
              <div className="flex items-start gap-3">
                <Avatar name={m.name} src={m.avatar} />
                <div className="min-w-0 flex-1">
                  <input
                    type="text"
                    value={m.name}
                    maxLength={120}
                    onChange={(e) => update(m.notionId, { name: e.target.value })}
                    aria-label="Name the bot should use"
                    className="w-full rounded-lg bg-fill-3 px-2.5 py-1.5 text-sm font-semibold text-ink focus:ring-2 focus:ring-sys-blue/40 focus:outline-none"
                  />
                  {m.email && m.email !== m.name ? <p className="mt-1 truncate text-xs text-muted">{m.email}</p> : null}
                  <label className="mt-1.5 flex items-center gap-2 text-xs text-muted">
                    <input type="radio" name={`team-default-${bot.slug}`} checked={m.default} onChange={() => setMembers((all) => all.map((x) => ({ ...x, default: x.notionId === m.notionId })))} className="h-3.5 w-3.5 accent-[var(--accent)]" />
                    Default: tasks that fit nobody else go here
                  </label>
                </div>
                <button type="button" onClick={() => remove(m.notionId)} className="hit -mt-1 -mr-1 rounded-full p-2 text-muted hover:bg-fill-3 hover:text-ink" aria-label={`Remove ${m.name}`}>
                  <Icon name="xmark" className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-3 space-y-2">
                <input type="text" value={m.role} maxLength={200} onChange={(e) => update(m.notionId, { role: e.target.value })} placeholder="Role, e.g. marketing lead" aria-label={`${m.name}'s role`} className={field} />
                <textarea
                  value={m.details}
                  maxLength={1500}
                  rows={2}
                  onChange={(e) => update(m.notionId, { details: e.target.value })}
                  placeholder="What to send them and what not to: meets prospects in person; presents proposals; prices and contracts still go to the owner"
                  aria-label={`What ${m.name} does`}
                  className={`${field} resize-y`}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">Nobody yet. {bot.name} assigns tasks by whatever name it writes, and unknown names are left unassigned.</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {available.length ? (
          <>
            <select value={pick || available[0].id} onChange={(e) => setPick(e.target.value)} aria-label="Person to add" className={`${field} w-auto max-w-full pr-8`}>
              {available.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                  {u.email && u.email !== u.name ? ` · ${u.email}` : ""}
                  {u.guest ? " (guest)" : ""}
                </option>
              ))}
            </select>
            <button type="button" onClick={add} className={buttonClass("tinted", "sm")}>
              <Icon name="plus" className="h-3.5 w-3.5" />
              Add
            </button>
          </>
        ) : loaded.notionError ? null : (
          <span className="text-sm text-muted">Everyone in the workspace is on the team.</span>
        )}
        <button type="button" onClick={() => void load(true)} className={buttonClass("plain", "sm")}>
          <Icon name="arrow-clockwise" className="h-3.5 w-3.5" />
          Refresh from Notion
        </button>
      </div>

      {loaded.notionError ? (
        <p className="rounded-lg bg-sys-orange/12 px-3 py-2 text-sm text-warn">{loaded.notionError} You can still edit the people already here.</p>
      ) : (
        <p className="text-xs text-muted">
          Workspace members are listed, plus guests who are already assigned to a task on the board. To add someone new, invite them in Notion (Settings →
          Members), or share the task board with them and assign them one task, then press Refresh.
        </p>
      )}

      <div className="flex justify-end gap-2 border-t border-line pt-3">
        <button type="button" onClick={() => setEditing(false)} className={buttonClass("gray", "sm")}>
          {dirty ? "Cancel" : "Done"}
        </button>
        <button type="button" onClick={() => void save()} disabled={!dirty || saving} className={`${buttonClass("prominent", "sm")} disabled:!opacity-40`}>
          {saving ? <Spinner small /> : null}
          {saving ? "Saving…" : "Save team"}
        </button>
      </div>
    </div>
  );

  const shown = saved.slice(0, 6);
  return (
    <section className="rounded-xl bg-panel p-4 text-sm">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-ink">Team</h2>
        {loaded ? (
          <button type="button" onClick={() => setEditing(true)} className={buttonClass("tinted", "sm")}>
            {saved.length ? "Edit" : "Add people"}
          </button>
        ) : null}
      </div>
      <p className="mb-3 text-xs text-muted">Who {bot.name} may assign tasks to. Every task goes to one of them.</p>
      {loadError ? (
        <p className="rounded-lg bg-sys-red/10 px-3 py-2 text-bad">Could not load the team: {loadError}</p>
      ) : !loaded ? (
        <p className="flex items-center gap-2 text-muted">
          <Spinner small /> Loading…
        </p>
      ) : saved.length ? (
        <ul className="space-y-2">
          {shown.map((m) => (
            <li key={m.notionId} className="flex items-center gap-2.5">
              <Avatar name={m.name} src={m.avatar} />
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">
                  {m.name}
                  {m.default ? <span className="ml-1.5 rounded-full bg-sys-blue/10 px-1.5 py-0.5 text-2xs font-semibold text-info">default</span> : null}
                </div>
                <div className="truncate text-xs text-muted">{m.role || m.email || "no role given"}</div>
              </div>
            </li>
          ))}
          {saved.length > shown.length ? <li className="text-xs text-muted">and {saved.length - shown.length} more</li> : null}
        </ul>
      ) : (
        <p className="text-muted">Nobody yet: tasks are assigned by whatever name the bot writes, and unknown names stay unassigned.</p>
      )}

      <Sheet
        open={editing}
        onClose={() => {
          setEditing(false);
          setMembers(saved);
          setNotice(null);
        }}
        title="Team"
        wide
      >
        {editor}
      </Sheet>
    </section>
  );
}
