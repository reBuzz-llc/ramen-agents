"use client";
// The lead's Sample box: the Site Builder's newest sample page for a no-site lead, in a sandboxed
// preview, with the person's three decisions -- Approve (samples.review), Request changes (a note the agent reads on
// its next turn) and Take down. The Mac's publisher puts an approved sample up and sets it live with its address;
// a live page comes down after 30 days or when a person takes it down. Hold keeps it off the web (owner and
// manager), Handover downloads the page with facts.md for the person who makes the final site, the version list previews
// an earlier one, and a frozen sample (the lead answered) takes a note as the next version while it stays up.
import { agentName } from "@/lib/agent-names";
import { useEffect, useState } from "react";
import { btnDanger, btnOutline, btnPrimary, control } from "@/lib/ui-classes";

type Sample = { id: string; slug: string; template: string; status: string; version: number; note: string; draftedBy: string; reviewedBy: string; url: string; updatedAt: string;
  hold?: boolean; frozenAt?: string | null; changesNote?: string };
type Version = { version: number; status: string; madeBy: string; madeAt: string; current: boolean; photosGone?: number };
const LABEL: Record<string, string> = { draft: "Draft ready: check it", changes_requested: "Sent back for changes", approved: "Approved: goes live on the next publish run", live: "Live", taken_down: "Taken down" };

export function SampleBox({ leadId, noSite }: { leadId: string; noSite: boolean }) {
  const [list, setList] = useState<Sample[] | null>(null);
  const [canReview, setCanReview] = useState(false);
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [tick, setTick] = useState(0);
  const [versions, setVersions] = useState<Version[]>([]);
  const [shown, setShown] = useState<number | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/samples?lead_id=${encodeURIComponent(leadId)}`)
      .then((r) => r.json() as Promise<{ ok: boolean; samples?: Sample[]; versions?: Version[]; canReview?: boolean }>)
      .then((d) => {
        if (!live) return;
        setList(d.ok ? (d.samples ?? []) : []);
        setVersions(d.ok ? (d.versions ?? []) : []);
        setShown(null);
        setCanReview(!!d.canReview);
      })
      .catch(() => live && setList([]));
    return () => {
      live = false;
    };
  }, [leadId, tick]);
  const load = () => setTick((t) => t + 1);
  if (!list || (!list.length && !noSite)) return null;
  const s = list[0];
  const frozenUp = !!s?.frozenAt && (s.status === "approved" || s.status === "live");
  const act = async (action: "approve" | "changes" | "takedown" | "hold" | "release") => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`/api/samples/${s.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note, version: shown ?? s.version }) }); // 703 A1: the version on screen
      const d = (await r.json()) as { ok: boolean; error?: string };
      if (!d.ok) setMsg(d.error ?? "That failed.");
      else {
        setMsg(
          action === "approve" ? "Approved."
            : action === "changes" ? (frozenUp ? `Noted: the ${agentName("Site Builder")} makes the next version; this one stays up meanwhile.` : `Sent back: the ${agentName("Site Builder")} reads your note on its next turn.`)
              : action === "hold" ? "On hold: it stays off the web until someone releases it."
                : action === "release" ? "Released: it publishes again as its status says."
                  : "Taken down.",
        );
        setNote("");
        setAsking(false);
        load();
      }
    } catch {
      setMsg("No answer from the server.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-4 rounded-xl border border-line bg-panel p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink">Sample site</h3>
        {s ? (
          <span className="text-xs text-muted">
            {LABEL[s.status] ?? s.status} · version {s.version} · {s.template}
            {s.reviewedBy ? ` · ${agentName(s.reviewedBy)}` : ""}
            {s.hold ? " · on hold" : ""}
            {s.frozenAt ? " · frozen (the lead answered)" : ""}
          </span>
        ) : null}
      </div>
      {!s ? (
        <p className="mt-1 text-sm text-muted">No sample yet. The {agentName("Site Builder")} drafts one for a no-site lead that answered; it shows here for a person to check.</p>
      ) : (
        <>
          {s.status === "live" && s.url ? (
            <p className="mt-2 text-sm">
              Live at{" "}
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="underline">
                {s.url}
              </a>{" "}
              (comes down 30 days after it went up)
            </p>
          ) : null}
          {(s.status === "changes_requested" && s.note) || s.changesNote ? <p className="mt-2 rounded-lg bg-fill-2 px-3 py-2 text-sm">Your note: {s.changesNote || s.note}</p> : null}
          {s.status !== "taken_down" ? (
            <iframe
              title={`Sample page for this lead, version ${shown ?? s.version}`}
              src={`/api/samples/${s.id}/preview?v=${shown ?? s.version}`}
              sandbox=""
              className="mt-2 h-96 w-full rounded-lg border border-line bg-white"
            />
          ) : null}
          {s.status === "draft" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {canReview ? (
                <button type="button" disabled={busy} onClick={() => void act("approve")} className={btnPrimary}>
                  Approve
                </button>
              ) : null}
              <button type="button" disabled={busy} onClick={() => setAsking((a) => !a)} className={btnOutline} aria-expanded={asking}>
                Request changes
              </button>
              {canReview ? (
                <button type="button" disabled={busy} onClick={() => void act("takedown")} className={btnDanger}>
                  Take down
                </button>
              ) : null}
            </div>
          ) : s.status !== "taken_down" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {frozenUp ? (
                <button type="button" disabled={busy} onClick={() => setAsking((a) => !a)} className={btnOutline} aria-expanded={asking}>
                  Request changes
                </button>
              ) : null}
              {canReview ? (
                <button type="button" disabled={busy} onClick={() => void act("takedown")} className={btnDanger}>
                  Take down
                </button>
              ) : null}
            </div>
          ) : null}
          {s.status !== "taken_down" ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              {canReview ? (
                <button type="button" disabled={busy} onClick={() => void act(s.hold ? "release" : "hold")} className={btnOutline} aria-pressed={!!s.hold}>
                  {s.hold ? "Release hold" : "Hold (keep off the web)"}
                </button>
              ) : null}
              <a href={`/api/samples/${s.id}/bundle`} className={btnOutline} download>
                Handover (zip)
              </a>
            </div>
          ) : null}
          {versions.length > 1 ? (
            <details className="mt-2 text-xs text-muted">
              <summary className="cursor-pointer">Versions ({versions.length})</summary>
              <ul className="mt-1 space-y-1">
                {versions.map((v) => (
                  <li key={v.version} className="flex flex-wrap items-center gap-2">
                    <button type="button" className="underline" onClick={() => setShown(v.current ? null : v.version)} aria-current={(shown ?? s.version) === v.version}>
                      Version {v.version}
                    </button>
                    <span>
                      {v.current ? "current" : v.status.replace("_", " ")} · {v.madeAt.slice(0, 16).replace("T", " ")}
                      {v.madeBy ? ` · ${agentName(v.madeBy)}` : ""}
                    </span>
                    {v.photosGone ? <span data-photos-gone className="text-bad">{v.photosGone === 1 ? "1 photo was" : `${v.photosGone} photos were`} removed from this version</span> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          {asking ? (
            <div className="mt-2 flex flex-col gap-2">
              <label className="text-xs font-medium text-muted" htmlFor={`sample-note-${s.id}`}>
                What should change? The {agentName("Site Builder")} reads this.
              </label>
              <textarea id={`sample-note-${s.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className={`${control} h-auto py-2`} />
              <button type="button" disabled={busy || !note.trim()} onClick={() => void act("changes")} className={btnOutline}>
                Send back
              </button>
            </div>
          ) : null}
        </>
      )}
      {msg ? (
        <p role="status" className="mt-2 text-sm">
          {msg}
        </p>
      ) : null}
    </div>
  );
}
