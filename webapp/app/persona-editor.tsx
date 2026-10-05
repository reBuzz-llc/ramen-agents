"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BotProfile } from "@/lib/bot";
import type { ControlResult } from "@/lib/control";
import type { BotMachine } from "@/lib/machine";
import type { PersonaDoc } from "@/lib/persona";
import { sendJson } from "@/lib/client";
import { errorText } from "@/lib/format";
import AppChrome from "./app-chrome";
import { useLeaveGuard, useVisibleInterval } from "./hooks";
import CopyButton from "./copy-button";
import TeamPanel from "./team-panel";
import { buttonClass, Panel, Spinner } from "./ui";

type Draft = { bio: string; goals: string; persona: string };
type Notice = { tone: "good" | "bad" | "muted"; text: string } | null;

const MAX_BIO = 400;
const MAX_KB = 64;

const field =
  "w-full rounded-lg bg-fill-3 px-3.5 py-2.5 text-base text-ink placeholder:text-muted focus:ring-2 focus:ring-sys-blue/40 focus:outline-none";

export default function PersonaEditor({ bot }: { bot: BotProfile }) {
  const [doc, setDoc] = useState<PersonaDoc | null>(null);
  const [draft, setDraft] = useState<Draft>({ bio: "", goals: "", persona: "" });
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [conflict, setConflict] = useState<PersonaDoc | null>(null);
  const [needsRestart, setNeedsRestart] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [running, setRunning] = useState<boolean | null>(null);

  const adopt = useCallback((d: PersonaDoc) => {
    setDoc(d);
    setDraft({ bio: d.bio, goals: d.goals, persona: d.persona });
    setConflict(null);
  }, []);

  useEffect(() => {
    let live = true;
    fetch(`/api/bots/${bot.slug}/persona`, { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json();
        if (!live) return;
        if (!res.ok) setLoadError(body?.error ?? `HTTP ${res.status}`);
        else adopt(body as PersonaDoc);
      })
      .catch((err) => live && setLoadError(errorText(err)));
    return () => {
      live = false;
    };
  }, [bot.slug, adopt]);

  // Whether the bot is running decides what a save needs: a running bot keeps its old persona until restarted.
  const checkRunning = useCallback(
    () =>
      void fetch(`/api/bots/${bot.slug}/machine`, { cache: "no-store" })
        .then((r) => r.json() as Promise<BotMachine>)
        .then((m) => setRunning(m.error ? null : m.running))
        .catch(() => setRunning(null)),
    [bot.slug],
  );
  useVisibleInterval(checkRunning, 10000);

  const dirty = doc !== null && (draft.bio !== doc.bio || draft.goals !== doc.goals || draft.persona !== doc.persona);

  useLeaveGuard(dirty, "You have unsaved persona changes. Leave this page and lose them?");

  const save = useCallback(async () => {
    if (!doc || !dirty || saving) return;
    setSaving(true);
    setNotice(null);
    const sentDraft = draft;
    const sent = await sendJson<{ doc?: PersonaDoc; changed?: boolean; backup?: string | null; error?: string; current?: PersonaDoc }>(
      `/api/bots/${bot.slug}/persona`,
      "PUT",
      { ...draft, version: doc.version },
    );
    const body = sent.body;
    if (sent.status === 409 && body?.current) {
      setConflict(body.current);
      setNotice({ tone: "bad", text: body.error ?? "The persona changed on disk." });
    } else if (!sent.ok || !body?.doc) {
      setNotice({ tone: "bad", text: body?.error ?? sent.error ?? "request failed" });
    } else {
      // Keep whatever was typed while the save was in flight: only fields left untouched take the saved text.
      const saved = body.doc;
      setDoc(saved);
      setConflict(null);
      setDraft((cur) => ({
        bio: cur.bio !== sentDraft.bio ? cur.bio : saved.bio,
        goals: cur.goals !== sentDraft.goals ? cur.goals : saved.goals,
        persona: cur.persona !== sentDraft.persona ? cur.persona : saved.persona,
      }));
      if (body.changed) {
        setNeedsRestart(true);
        setNotice({ tone: "good", text: body.backup ? "Saved. The previous persona was backed up in the bot's workspace/backups folder." : "Saved." });
      } else {
        setNotice({ tone: "muted", text: "Nothing changed." });
      }
    }
    setSaving(false);
  }, [bot.slug, dirty, doc, draft, saving]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save]);

  async function restart() {
    setRestarting(true);
    const sent = await sendJson<ControlResult>(`/api/bots/${bot.slug}/control`, "POST", { op: "restart" });
    setNotice({ tone: sent.body?.ok ? "good" : "bad", text: sent.body?.note ?? sent.error ?? "request failed" });
    if (sent.body?.ok) {
      setNeedsRestart(false);
      setRunning(true);
    }
    setRestarting(false);
  }

  // The target market lives in target.toml; cards say {market} and friends instead of a place. Show what they become.
  const [target, setTarget] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/target", { cache: "no-store" })
      .then((r) => r.json() as Promise<Record<string, string>>)
      .then((t) => live && setTarget(t))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  const placeholders = useMemo(
    () => [...new Set([...`${draft.bio}\n${draft.goals}\n${draft.persona}`.matchAll(/\{(market|market_short|segment|trades|areas)\}/g)].map((m) => m[1]))],
    [draft.bio, draft.goals, draft.persona],
  );

  const personaKb = useMemo(() => new Blob([draft.persona, draft.goals]).size / 1024, [draft.persona, draft.goals]);
  const outline = useMemo(
    () =>
      draft.persona
        .split("\n")
        .filter((l) => /^##\s+\S/.test(l))
        .map((l) => l.replace(/^##\s+/, "")),
    [draft.persona],
  );
  const goalTitle = doc ? doc.goalHeading.replace(/^##\s+/, "") : "Goals";

  return (
    <AppChrome
      bot={bot}
      section="persona"
      title="Persona"
      subtitle={doc ? (dirty ? "Unsaved changes" : "All changes saved") : "Who the bot is and what it works toward"}
      actions={
        <button type="button" onClick={() => void save()} disabled={!dirty || saving || conflict !== null} className={`${buttonClass("prominent")} glass-tinted disabled:!opacity-40`}>
          {saving ? <Spinner /> : null}
          {saving ? "Saving…" : "Save"}
        </button>
      }
    >
      {notice ? (
        <div
          role="status"
          className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl p-3 text-sm ${
            notice.tone === "bad" ? "bg-sys-red/10 text-bad" : notice.tone === "good" ? "bg-sys-green/12 text-ink" : "bg-panel text-muted"
          }`}
        >
          <span>{notice.text}</span>
          {conflict ? (
            <button type="button" onClick={() => adopt(conflict)} className={buttonClass("gray", "sm")}>
              Load the version on disk (drops your edits)
            </button>
          ) : null}
        </div>
      ) : null}

      {needsRestart && running ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-sys-blue/10 p-3 text-sm">
          <span className="text-ink">{bot.name} is running with its old persona. It reads the persona only when it starts.</span>
          <button
            type="button"
            onClick={() => void restart()}
            disabled={restarting}
            className={buttonClass("prominent", "sm")}
          >
            {restarting ? <Spinner small /> : null}
            {restarting ? "Restarting…" : "Restart now"}
          </button>
        </div>
      ) : null}

      {loadError ? (
        <p className="rounded-xl bg-sys-red/10 p-4 text-sm text-bad">Could not load the persona: {loadError}</p>
      ) : !doc ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-5">
            {placeholders.length ? (
              <p className="rounded-xl bg-sys-blue/10 px-4 py-3 text-sm text-ink">
                This card names the target with placeholders, filled in when {bot.name} reads it:{" "}
                {placeholders.map((k, i) => (
                  <span key={k}>
                    {i ? " · " : ""}
                    <code className="font-mono text-xs">{`{${k}}`}</code> = <strong>{target?.[k] || "…"}</strong>
                  </span>
                ))}
                . Change the target under{" "}
                <Link href="/work-plan#target" className="font-semibold text-accent">
                  Work plan → Target
                </Link>
                ; keep the braces here so the card follows it.
              </p>
            ) : null}
            <Panel
              title="Bio"
              hint="One sentence the bot is given as who it is, at the top of its instructions and its journal."
              aside={
                <span className="inline-flex items-center gap-1">
                  {draft.bio.length} / {MAX_BIO}
                  <CopyButton text={() => draft.bio} what="bio" />
                </span>
              }
            >
              <input
                type="text"
                value={draft.bio}
                maxLength={MAX_BIO}
                onChange={(e) => setDraft((d) => ({ ...d, bio: e.target.value }))}
                className={field}
                aria-label="Bio"
              />
            </Panel>

            <Panel
              title="Goals"
              aside={draft.goals.trim() ? <CopyButton text={() => draft.goals} what="goals" /> : undefined}
              hint={
                doc.goalHeadingExists ? (
                  <>
                    What the bot is working toward. Saved as the “{goalTitle}” section of its persona.
                  </>
                ) : (
                  <>What the bot is working toward. Saved as a new “Goals” section at the end of its persona. Leave empty for a bot that picks its own.</>
                )
              }
            >
              <textarea
                value={draft.goals}
                onChange={(e) => setDraft((d) => ({ ...d, goals: e.target.value }))}
                rows={Math.min(14, Math.max(5, draft.goals.split("\n").length + 1))}
                placeholder={"- One outcome the bot should work toward\n- Another, as specific as you can make it"}
                className={`${field} font-mono text-[13px] leading-relaxed`}
                aria-label="Goals"
              />
            </Panel>

            <Panel
              title="Persona"
              hint="How the bot thinks, what it reads, and what it must never do. Markdown; lines starting with ## become sections."
              aside={
                <span className="inline-flex items-center gap-1">
                  {personaKb.toFixed(1)} / {MAX_KB} KB
                  <CopyButton text={() => draft.persona} what="persona" />
                </span>
              }
            >
              <textarea
                value={draft.persona}
                onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))}
                rows={Math.min(40, Math.max(12, draft.persona.split("\n").length + 2))}
                className={`${field} font-mono text-[13px] leading-relaxed`}
                spellCheck
                aria-label="Persona"
              />
            </Panel>
          </div>

          <aside className="space-y-5 lg:sticky lg:top-[calc(env(safe-area-inset-top)+4.75rem)] lg:self-start">
            <TeamPanel bot={bot} />

            <section className="rounded-xl bg-panel p-4 text-sm">
              <h2 className="mb-2 text-lg font-semibold text-ink">When it takes effect</h2>
              <p className="text-muted">
                {running === null
                  ? "The bot reads its persona when it starts."
                  : running
                    ? `${bot.name} is running. After saving, restart it to use the new persona.`
                    : `${bot.name} is not running. It uses the saved persona the next time it starts.`}
              </p>
              <p className="mt-2 text-xs text-muted">Each save keeps the previous version in the bot’s workspace/backups folder. Press ⌘S to save.</p>
            </section>

            <section className="rounded-xl bg-panel p-4 text-sm">
              <h2 className="mb-2 text-lg font-semibold text-ink">Sections</h2>
              {outline.length || draft.goals.trim() ? (
                <ol className="space-y-1">
                  {outline.map((h, i) => (
                    <li key={`${h}-${i}`} className="truncate text-ink/85">
                      {h}
                    </li>
                  ))}
                  {draft.goals.trim() ? <li className="truncate text-accent">{goalTitle} (from Goals)</li> : null}
                </ol>
              ) : (
                <p className="text-muted">No sections: the persona is one block of text.</p>
              )}
            </section>

            <section className="rounded-xl bg-panel p-4 text-xs text-muted">
              <p className="break-all">{doc.personaPath}</p>
              {doc.updatedAt ? <p className="mt-1">Last changed {new Date(doc.updatedAt).toLocaleString()}</p> : null}
            </section>
          </aside>
        </div>
      )}
    </AppChrome>
  );
}
