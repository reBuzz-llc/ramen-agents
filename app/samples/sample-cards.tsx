"use client";
// The Samples page's review screen, one sample at a time (a grid was cramped and its quarter-size previews
// unreadable). The chosen sample shows at its real size in a phone frame, with the decisions always in view (a bar
// along the bottom on a phone) and, beside the preview, one-line rows (one open at a time, "why this design" first) whose titles carry their count or
// warning: what changed, the guest photos to swap, the Reference mark, the change requests (each its own record
// with its pictures), why this design and its sources. Which row is open is remembered per sample in this browser only.
// Before: a grid of flip cards; their decisions and rows are the same here.
import PhotoViewer from "./photo-viewer";
import { agentName } from "@/lib/agent-names";
import { useRouter } from "next/navigation";
import { ALL_CHECKS, DISH_MAX, isChecked, PHOTO_RULES, REOPEN_NOTE, photoCount, photosLeft, photosRejected, REJECT_NOTE_MAX, sentBackMessage, type ReviewPhoto } from "@/lib/sample-photo-checks";
import { useEffect, useId, useRef, useState } from "react";
import { authorLine, canCloseRequest, CARD_LABEL, CARD_TONE as TONE, decisionMessage, FOLD_DEFAULT, foldToggle, foldsFrom, galleryLine, notCompleteLine, openRequestsLine, publisherRunning, requestState, undoMessage } from "@/lib/sample-labels";
import { REASON_MAX, type TakedownRecord } from "@/lib/sample-takedowns";
import type { CardRequest, SampleCard } from "@/lib/samples";
import { btnDanger, btnOutline, btnPrimary, btnText, control } from "@/lib/ui-classes";

/** An owner's Reference mark on a sample, pinned to the version it was set on. */
export type Mark = { version: number; family: string; setAt: string; setBy: string };
const FAMILY_LABEL: Record<string, string> = { eat: "Food and drink", shop: "Shops", services: "Services and repair", care: "Care and beauty", plain: "Other" };

export const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};
const hostOf = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};
const firstWords = (t: string, n = 80) => {
  const one = t.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n).replace(/\s+\S*$/, "")}…` : one;
};
const PICTURE_TYPES = ["image/png", "image/jpeg", "image/webp"];

/** Which row of a sample is open, remembered in this browser only (nothing server-side; storage may be unavailable). One
 *  open row at a time; a sample never seen here opens with "Why this design". */
function useFolds(id: string) {
  const key = `peek.sample-folds.${id}`;
  const [open, setOpen] = useState<string[]>([FOLD_DEFAULT]);
  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from this browser's storage after mount
      setOpen(foldsFrom(window.localStorage.getItem(key)));
    } catch {
      /* no storage: the default row stays open */
    }
  }, [key]);
  const toggle = (k: string) =>
    setOpen((cur) => {
      const next = foldToggle(cur, k);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* not remembered */
      }
      return next;
    });
  return { isOpen: (k: string) => open.includes(k), toggle };
}

/** One row: a 44 px title button (one open at a time) with its count or warning; `aside` sits beside it (a switch). */
function Fold({ title, open, onToggle, warn = false, aside, children, name }: { title: React.ReactNode; open: boolean; onToggle: () => void; warn?: boolean; aside?: React.ReactNode; children: React.ReactNode; name: string }) {
  const id = useId();
  return (
    <div data-fold={name} data-open={open || undefined}>
      <div className="flex min-h-11 items-center gap-2">
        <button type="button" onClick={onToggle} aria-expanded={open} aria-controls={id} className={`flex min-h-11 min-w-0 flex-1 items-center gap-2 text-left text-sm ${warn ? "font-semibold text-accent-ink" : "text-ink"}`}>
          <span aria-hidden className={`inline-block shrink-0 text-xs text-muted transition-transform motion-reduce:transition-none ${open ? "rotate-90" : ""}`}>
            ▸
          </span>
          <span className="min-w-0 truncate">{title}</span>
        </button>
        {aside}
      </div>
      {open ? (
        <div id={id} className="pb-3 pl-5 text-sm">
          {children}
        </div>
      ) : null}
    </div>
  );
}

type Ask = null | "changes" | "reject" | "takedown" | "undo";
/** One photo's decision as this card last set it. */
type PhotoState = Pick<ReviewPhoto, "checks" | "rejected" | "note" | "sentOn">;

/** One sample, large: the decisions, the phone-sized preview at real size, and its rows. */
export default function SampleDetail({ c, isOwner = false, canMark = false, viewer = null, mark = null, takedown = null, backHref, publishPolledAt = null }: { c: SampleCard; /** who is looking, for who may close a request */ viewer?: { role: string; userId: string } | null; /** who took it down, when and why, when Peek holds it. */ takedown?: TakedownRecord | null; isOwner?: boolean; /** who may use the Reference row (samples.review): managers too. */ canMark?: boolean; mark?: Mark | null; backHref: string; publishPolledAt?: string | null }) {
  const router = useRouter();
  const [ask, setAsk] = useState<Ask>(null);
  const [note, setNote] = useState("");
  // the take-down's own words, so a half-typed change request never becomes its reason
  const [reason, setReason] = useState("");
  const [asked, setAsked] = useState(false);
  const [cleared, setCleared] = useState(false);
  const [pictures, setPictures] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [view, setView] = useState<"phone" | "wide">("phone");
  // the sample's extra pages (a gallery) open inside the frame, not in new tabs
  const [pg, setPg] = useState("");
  const folds = useFolds(c.id);
  // a decision shows at once; kept per version, so a new version reads what the server has
  const [decided, setDecided] = useState<Record<string, PhotoState>>({});
  const [savingPhoto, setSavingPhoto] = useState("");
  // saves go one at a time, in the order pressed: a note saved as its box loses focus lands before the decision the same tap made
  const photoSaves = useRef<Promise<unknown>>(Promise.resolve());
  // the photos this person has opened at full size on this card; the marks saved since the page loaded
  const [seenFull, setSeenFull] = useState<Record<string, true>>({});
  const [marks, setMarks] = useState<Record<string, { dish: string; dishSet: boolean }>>({});
  const photoRows: ReviewPhoto[] = (c.photoChecks ?? []).map((p) => ({ ...p, ...marks[`${c.version}:${p.base}`], ...decided[`${c.version}:${p.base}`] }));
  const photosToGo = photosLeft(photoRows);
  const rejectedPhotos = photoRows.filter((p) => p.rejected);
  // a draft carries all its rejected photos back; on any other status, those no request has carried from this version
  const toSend = c.status === "draft" ? rejectedPhotos : rejectedPhotos.filter((p) => p.sentOn !== c.version);
  const postPhoto = (body: Record<string, unknown>) => {
    const job = photoSaves.current
      .then(() => fetch(`/api/samples/${c.id}/photo-checks`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }))
      .then((x) => x.json())
      .catch(() => ({ ok: false, error: "No answer from the server." })) as Promise<{ ok: boolean; error?: string }>;
    photoSaves.current = job;
    return job;
  };
  // a note saves quietly: disabling a button as the box loses focus would swallow the tap that moved the focus there
  const decide = async (p: ReviewPhoto, next: PhotoState, body: Record<string, unknown>, quiet = false) => {
    const at = `${c.version}:${p.base}`;
    const before: PhotoState = { checks: p.checks, rejected: p.rejected, note: p.note, sentOn: p.sentOn };
    if (!quiet) setSavingPhoto(p.base);
    setDecided((t) => ({ ...t, [at]: next }));
    const r = await postPhoto({ base: p.base, ...body });
    if (!quiet) setSavingPhoto("");
    if (!r.ok) {
      setDecided((t) => ({ ...t, [at]: before }));
      setMsg(r.error ?? "That decision was not saved.");
    }
  };
  const acceptPhoto = (p: ReviewPhoto) => void decide(p, { checks: ALL_CHECKS, rejected: undefined, note: undefined, sentOn: undefined }, { checks: ALL_CHECKS });
  const rejectOne = (p: ReviewPhoto) => void decide(p, { checks: [], rejected: true, note: p.note ?? "", sentOn: p.rejected ? p.sentOn : undefined }, { reject: true, note: p.note ?? "" });
  const noteOne = (p: ReviewPhoto, raw: string) => {
    const note = raw.replace(/\s+/g, " ").trim();
    if (note !== (p.note ?? "")) void decide(p, { checks: [], rejected: true, note, sentOn: undefined }, { reject: true, note }, true);
  };
  // an owner or a manager puts a colour-graded photo's original back
  const restorePhoto = async (p: ReviewPhoto) => {
    if (!window.confirm("Put the original photo back? A live page shows it after its next publish.")) return;
    setSavingPhoto(p.base);
    const r = await postPhoto({ base: p.base, restore: true });
    setSavingPhoto("");
    setMsg(r.ok ? "The original photo is back." : (r.error ?? "The original was not put back."));
    if (r.ok) router.refresh();
  };
  // what a photo shows, saved at once and separate from Accept
  const markDish = async (p: ReviewPhoto, dish: string | null) => {
    const at = `${c.version}:${p.base}`;
    const before = { dish: p.dish, dishSet: p.dishSet };
    setMarks((m) => ({ ...m, [at]: { dish: dish ?? "", dishSet: true } }));
    const r = await postPhoto({ base: p.base, dish });
    if (!r.ok) {
      setMarks((m) => ({ ...m, [at]: before }));
      setMsg(r.error ?? "That mark was not saved.");
    }
  };
  const sendBack = async () => {
    setBusy(true);
    setMsg("");
    try {
      await photoSaves.current;
      const r = (await postPhoto({ sendBack: true, version: c.version })) as { ok: boolean; error?: string; sent?: number };
      if (!r.ok) setMsg(r.error ?? "Not sent.");
      else {
        const stays = c.url && c.approvedVersion !== null && toSend.some((p) => p.onWeb) ? c.approvedVersion : null;
        setDecided((t) => ({ ...t, ...Object.fromEntries(toSend.map((p) => [`${c.version}:${p.base}`, { checks: [], rejected: true, note: p.note, sentOn: c.version }])) }));
        setMsg(sentBackMessage(r.sent ?? toSend.length, stays));
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  };
  // the request box takes the cursor as it opens, so the owner types while the page stays in view
  const noteBox = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (ask === "changes") noteBox.current?.focus();
  }, [ask]);
  const dead = c.status === "taken_down" || c.status === "rejected";
  const open = c.status === "draft" || c.status === "changes_requested";
  const up = c.approvedVersion !== null && !dead;
  // the owner deletes a dead sample (taken down or rejected) with all its versions; the lead stays
  const remove = async () => {
    if (!window.confirm(`Delete ${c.business}'s sample and all its versions? This can't be undone.`)) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`/api/samples/${c.id}`, { method: "DELETE" });
      const d = (await r.json()) as { ok: boolean; error?: string };
      if (!d.ok) setMsg(d.error ?? "Not deleted.");
      else router.push(backHref);
    } catch {
      setMsg("No answer from the server.");
    } finally {
      setBusy(false);
    }
  };
  const act = async (action: "approve" | "takedown" | "reject") => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`/api/samples/${c.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, note: action === "takedown" ? reason : note, version: c.version, ...(action === "takedown" ? { asked } : {}) }) });
      const d = (await r.json()) as { ok: boolean; error?: string };
      if (!d.ok) setMsg(d.error ?? "That failed.");
      else {
        // what the decision will really do, from the publish rules and the publisher's last visit
        setMsg(decisionMessage(action, c, publishPolledAt));
        setNote("");
        setReason("");
        setAsked(false);
        setAsk(null);
        router.refresh();
      }
    } catch {
      setMsg("No answer from the server.");
    } finally {
      setBusy(false);
    }
  };
  // back to where it was; the publisher puts it up at the same address
  const undo = async () => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`/api/samples/${c.id}/undo-takedown`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cleared }) });
      const d = (await r.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
      if (!d.ok) setMsg(d.error ?? "It was not put back.");
      else {
        setMsg(undoMessage(c, publishPolledAt));
        setCleared(false);
        setAsk(null);
        router.refresh();
      }
    } catch {
      setMsg("No answer from the server.");
    } finally {
      setBusy(false);
    }
  };
  // a change request, its own record, with up to three pictures
  const sendRequest = async () => {
    if (pictures.length > 3) return setMsg("At most three pictures.");
    setBusy(true);
    setMsg("");
    try {
      const form = new FormData();
      form.set("text", note);
      for (const f of pictures) form.append("pictures", f);
      const r = await fetch(`/api/samples/${c.id}/requests`, { method: "POST", body: form });
      const d = (await r.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string; request?: { pictures: number } };
      if (!d.ok) setMsg(d.error ?? "Not sent.");
      else {
        setMsg(d.request?.pictures ? `Sent: the ${agentName("site helper")} gets your pictures, the ${agentName("Site Builder")} your words.` : `Sent: the ${agentName("Site Builder")} reads your request on its next turn.`);
        setNote("");
        setPictures([]);
        setAsk(null);
        router.refresh();
      }
    } catch {
      setMsg("No answer from the server.");
    } finally {
      setBusy(false);
    }
  };
  const openAsks = c.requests.filter((r) => r.status === "open");
  const toCheck = c.requests.filter((r) => r.status === "addressed").length; // what a round says it did
  // shown the same to the owner and to members; the server refuses Approve on it
  const notDone = open && c.notComplete ? `${notCompleteLine(c.version, c.notComplete)}. It can be approved once a complete version arrives.` : "";
  const decisions = !dead ? (
    <>
      {/* with a rejected photo the page cannot be approved, so its place goes to sending the photos back */}
      {toSend.length ? (
        <button type="button" disabled={busy || (c.status === "draft" && photosToGo > 0)} onClick={() => void sendBack()} className={btnPrimary} data-send-back>
          Send back with {toSend.length} rejected photo{toSend.length === 1 ? "" : "s"}
        </button>
      ) : c.status === "draft" ? (
        <button type="button" disabled={busy || photosToGo > 0 || rejectedPhotos.length > 0 || openAsks.length > 0} onClick={() => void act("approve")} className={btnPrimary}>
          Approve version {c.version}
        </button>
      ) : null}
      <button type="button" disabled={busy} onClick={() => setAsk((a) => (a === "changes" ? null : "changes"))} className={btnOutline} aria-expanded={ask === "changes"}>
        Request changes
      </button>
      {open && !up ? (
        <button type="button" disabled={busy} onClick={() => setAsk((a) => (a === "reject" ? null : "reject"))} className={btnDanger} aria-expanded={ask === "reject"}>
          Reject
        </button>
      ) : null}
      {/* Open lead on the right of Open site; one group, so a narrow column never splits them */}
      <span className="inline-flex shrink-0 items-center gap-2" data-site-links>
        <a href={c.open} target="_blank" rel="noopener" className={btnOutline}>
          Open site <span aria-hidden>↗</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <a href={c.leadHref} className={btnOutline} data-lead-link>
          Open lead
        </a>
      </span>
    </>
  ) : (
    <>
      {c.status === "taken_down" && c.approvedVersion !== null ? (
        <button type="button" disabled={busy} onClick={() => setAsk((a) => (a === "undo" ? null : "undo"))} className={btnPrimary} aria-expanded={ask === "undo"} data-undo-takedown>
          Undo take down
        </button>
      ) : null}
      {/* Open lead on the right of Open site; one group, so a narrow column never splits them */}
      <span className="inline-flex shrink-0 items-center gap-2" data-site-links>
        <a href={c.open} target="_blank" rel="noopener" className={btnOutline}>
          Open site <span aria-hidden>↗</span>
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
        <a href={c.leadHref} className={btnOutline} data-lead-link>
          Open lead
        </a>
      </span>
      {isOwner ? (
        <button type="button" disabled={busy} onClick={() => void remove()} className={btnDanger} data-delete-sample>
          Delete sample
        </button>
      ) : null}
    </>
  );
  // the Phone/Wide and Main/Gallery switches sit directly above the preview, lined up with its frame
  const switches = (
    <div className={`flex flex-wrap items-center gap-2 ${c.pages.length ? "mb-2" : "md:mb-2"}`} data-preview-switches>
          <div role="group" aria-label="Preview size" className="hidden rounded-full border border-line bg-panel p-1 text-sm md:inline-flex">
            {(["phone", "wide"] as const).map((v) => (
              <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={`min-h-9 rounded-full px-3 ${view === v ? "bg-accent-tint font-semibold text-accent-ink" : "text-muted"}`}>
                {v === "phone" ? "Phone" : "Wide"}
              </button>
            ))}
          </div>
          {c.pages.length ? (
            // the main page and each extra page (a gallery), shown inside the frame
            <div role="group" aria-label="Page" className="inline-flex flex-wrap rounded-full border border-line bg-panel p-1 text-sm" data-page-switch>
              {[{ name: "" }, ...c.pages].map((p) => (
                <button key={p.name || "main"} type="button" aria-pressed={pg === p.name} onClick={() => setPg(p.name)} className={`min-h-9 rounded-full px-3 capitalize ${pg === p.name ? "bg-accent-tint font-semibold text-accent-ink" : "text-muted"}`}>
                  {p.name ? p.name.replace(/-/g, " ") : "Main"}
                </button>
              ))}
            </div>
          ) : null}
    </div>
  );
  return (
    <article id={`sample-${c.id}`} data-sample={c.id} className="min-w-0 pb-24 md:pb-0">
      <a href={backHref} className={`${btnText} md:hidden`}>
        <span aria-hidden>←</span> All samples
      </a>

      {/* so a change request can be written while watching the preview: on a computer the decisions, the request
          box and the rows sit on the left and the page stays in view on the right (sticky); on a phone the page comes first.
          The header sits in the left column too, so the
          page starts at the top beside it (the 1fr row takes the page's height, never a gap under the header) */}
      <div className={`mt-1 grid gap-x-6 gap-y-4 ${view === "phone" ? "lg:grid-cols-[minmax(0,1fr)_25.625rem] lg:grid-rows-[auto_1fr]" : ""}`}>
        <header className={`order-1 min-w-0 ${view === "phone" ? "lg:col-start-1 lg:row-start-1" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="min-w-0 text-xl font-semibold break-words text-ink sm:text-2xl">{c.business}</h2>
            <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[c.status] ?? "bg-bg text-ink"}`}>{CARD_LABEL[c.status] ?? c.status}</span>
          </div>
          <p className="mt-1 text-sm text-muted">{[c.area, c.trade].filter(Boolean).join(" · ") || "Area not known"}</p>
          <p className="text-xs text-muted">
            Version {c.version} · <span suppressHydrationWarning>{when(c.draftedAt)}</span>
            {c.draftedBy || c.firstDraftedBy ? <span data-author> · {authorLine(c.firstDraftedBy ?? c.draftedBy, c.draftedBy, agentName)}</span> : null}
            {/* whoever pressed the last decision, now that any member can */}
            {c.reviewedBy ? <span data-last-decision> · Last decision: {agentName(c.reviewedBy)}</span> : null}
            {c.hold ? " · on hold" : ""}
            {c.frozen ? " · frozen (the lead answered)" : ""}
          </p>
          {(c.url || c.status === "live") && !publisherRunning(publishPolledAt) ? (
            <p className="mt-1 text-sm text-ink" data-publish-paused>
              Publishing to the web is paused on this Mac: the address shows what was last published, and no change goes live yet.
            </p>
          ) : null}
          {up && c.approvedVersion !== c.version ? (
            <p className="mt-1 text-sm font-semibold text-ink" data-live-line>
              {c.url ? "Live" : "Approved"}: version {c.approvedVersion} · {notDone ? notDone : open && openAsks.length ? openRequestsLine(c.version, openAsks.length) : `version ${c.version} waits for you`}
            </p>
          ) : notDone ? (
            <p className="mt-1 break-words text-sm font-semibold text-ink" data-not-complete>{notDone}</p>
          ) : open && openAsks.length ? (
            <p className="mt-1 text-sm font-semibold text-ink" data-open-requests>{openRequestsLine(c.version, openAsks.length)}</p>
          ) : null}
        </header>
        <div className={`order-3 min-w-0 ${view === "phone" ? "lg:order-none lg:col-start-1 lg:row-start-2" : ""}`}>
          {/* the decisions: always in view -- here on a computer, a bar along the bottom on a phone */}
          <div className="fixed inset-x-0 bottom-0 z-20 flex flex-nowrap items-center gap-2 overflow-x-auto border-t border-line bg-panel/95 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur md:static md:mt-4 md:flex-wrap md:overflow-visible md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none [&>*]:shrink-0" data-decisions>
            {decisions}
          </div>
          {photosToGo && !dead ? (
            <button type="button" onClick={() => !folds.isOpen("photos") && folds.toggle("photos")} className="mt-2 block min-h-11 text-left text-sm font-semibold text-accent-ink hover:underline" data-photos-left>
              {photoCount(photosToGo)} to check{c.status === "draft" ? (toSend.length ? " before sending back" : " before Approve") : ""}
            </button>
          ) : null}

          {ask === "changes" ? (
            <div className="mt-3 flex max-w-xl flex-col gap-2 rounded-xl border border-line bg-panel p-3" data-request-box>
              <label className="text-xs font-medium text-muted" htmlFor={`sample-note-${c.id}`}>
                What should change? Each request is kept on its own; the {agentName("Site Builder")} reads the words.
              </label>
              <textarea ref={noteBox} id={`sample-note-${c.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} rows={3} className={`${control} h-auto py-2`} />
              <label className="text-xs font-medium text-muted">
                Pictures (up to three: png, jpg or webp). They go to the {agentName("site helper")}, with their place and device data removed.
                <input
                  type="file"
                  multiple
                  accept={PICTURE_TYPES.join(",")}
                  onChange={(e) => {
                    const files = [...(e.target.files ?? [])].filter((f) => PICTURE_TYPES.includes(f.type));
                    setPictures(files.slice(0, 3));
                    setMsg(files.length > 3 ? "Only the first three pictures are kept." : "");
                  }}
                  className="mt-1 block min-h-11 w-full text-sm"
                />
              </label>
              {pictures.length ? <p className="text-xs text-muted">{pictures.map((f) => f.name).join(", ")}</p> : null}
              <button type="button" disabled={busy || !note.trim()} onClick={() => void sendRequest()} className={btnOutline}>
                Send the request
              </button>
            </div>
          ) : null}
          {ask === "reject" ? (
            <div className="mt-3 flex max-w-xl flex-col gap-2 rounded-xl border border-line bg-panel p-3">
              <label className="text-xs font-medium text-muted" htmlFor={`sample-reject-${c.id}`}>
                Why not? (optional) The {agentName("Site Builder")} reads this before its next pages.
              </label>
              <textarea id={`sample-reject-${c.id}`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={3} className={`${control} h-auto py-2`} />
              <button type="button" disabled={busy} onClick={() => void act("reject")} className={btnOutline}>
                Reject this sample
              </button>
            </div>
          ) : null}
          {ask === "undo" ? (
            <div className="mt-3 flex max-w-xl flex-col gap-2 rounded-xl border border-line bg-panel p-3 text-sm" data-undo-box>
              <p className="font-semibold text-ink">Put version {c.approvedVersion} back on the web?</p>
              <p className="text-ink">It becomes public again at the same address on the publisher&apos;s next run. Its versions stay as they are.</p>
              {takedown?.at ? (
                <p className="text-muted">
                  Taken down by {takedown.by ? agentName(takedown.by) : "someone"} · <span suppressHydrationWarning>{when(takedown.at)}</span>
                </p>
              ) : null}
              <p className="text-muted">{takedown?.reason ? `Reason: ${takedown.reason}` : "No reason was recorded."}</p>
              {photosToGo ? <p className="text-ink">{photoCount(photosToGo)} on this sample still {photosToGo === 1 ? "needs its" : "need their"} checks and will show as to check.</p> : null}
              {c.url ? <p className="font-semibold text-ink">It is still coming off the web: undo it after the publisher&apos;s next run.</p> : null}
              {c.website ? <p className="font-semibold text-ink">The business has a website now, so its sample does not go back up.</p> : null}
              {takedown?.asked ? (
                <label className="flex min-h-11 items-center gap-2 font-semibold text-ink">
                  <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={cleared} onChange={(e) => setCleared(e.target.checked)} data-undo-cleared />
                  The business or a photographer asked for this take-down. I checked with them that it can go back up.
                </label>
              ) : null}
              <button type="button" disabled={busy || !!c.url || !!c.website || (!!takedown?.asked && !cleared)} onClick={() => void undo()} className={btnPrimary} data-undo-confirm>
                Put it back
              </button>
            </div>
          ) : null}
          {msg ? (
            <p role="status" className="mt-3 text-sm font-semibold">
              {msg}
            </p>
          ) : null}
          <div className="mt-5">
            {galleryLine(c.galleryPhotos) ? (
              <p data-gallery className="mb-2 text-sm text-muted">
                {galleryLine(c.galleryPhotos)}
              </p>
            ) : null}
            {/* the rows, one open at a time ("why this design" first); each title carries its count or warning */}
            <div className="min-w-0">
              <div className="divide-y divide-line border-y border-line" data-folds>
                {/* Reference, Requests, What changed, Why this design, then the photo swap */}
                <ReferenceRow c={c} canMark={canMark} mark={mark} open={folds.isOpen("reference")} onToggle={() => folds.toggle("reference")} />
                {c.requests.length ? (
                  <Fold
                    name="requests"
                    warn={openAsks.length > 0}
                    title={<>Requests · {openAsks.length} open{toCheck ? ` · ${toCheck} to check` : ""}{openAsks.length ? <span className="font-normal">: {firstWords(openAsks[0].text, 50)}</span> : null}</>}
                    open={folds.isOpen("requests")}
                    onToggle={() => folds.toggle("requests")}
                  >
                    <ul className="space-y-3">
                      {c.requests.map((r) => (
                        <RequestItem key={r.id} sampleId={c.id} r={r} draftedBy={c.draftedBy} version={c.version} canClose={!dead && !!viewer && canCloseRequest(viewer, r)} />
                      ))}
                    </ul>
                  </Fold>
                ) : null}
                {c.changes ? (
                  <Fold name="changes" title={<>What changed: {firstWords(c.changes)}</>} open={folds.isOpen("changes")} onToggle={() => folds.toggle("changes")}>
                    <p className="text-ink">{c.changes}</p>
                    {c.note && !openAsks.length ? <p className="mt-2 rounded-lg bg-bg px-3 py-2">{c.status === "rejected" ? "Why rejected" : "Note"}: {c.note}</p> : null}
                  </Fold>
                ) : null}
                {c.designReason || c.sources.length ? (
                  <Fold name="why" title={`Why this design · ${c.sources.length} source${c.sources.length === 1 ? "" : "s"}`} open={folds.isOpen("why")} onToggle={() => folds.toggle("why")}>
                    {c.designReason ? <p className="whitespace-pre-line text-ink">{c.designReason}</p> : <p className="text-muted">No design reason for this version.</p>}
                    {c.sources.length ? (
                      <ul className="mt-2 space-y-1">
                        {c.sources.map((s, i) => (
                          <li key={`${s.fact}-${i}`} className="break-words">
                            <span className="text-ink">{s.fact}</span>
                            {": "}
                            <a href={s.from} target="_blank" rel="noopener noreferrer" className="text-accent-ink underline">
                              {hostOf(s.from)}
                            </a>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </Fold>
                ) : null}
                {photoRows.length && !dead ? (
                  <Fold
                    name="photos"
                    warn={photosToGo > 0 || toSend.length > 0}
                    title={photosToGo ? `Photos to check · ${photosToGo} of ${photoRows.length} left` : `Photos checked · ${photoRows.length}${rejectedPhotos.length ? ` · ${photosRejected(photoRows)} rejected` : ""}`}
                    open={folds.isOpen("photos")}
                    onToggle={() => folds.toggle("photos")}
                  >
                    <PhotoChecks sampleId={c.id} rows={photoRows} choices={c.dishChoices ?? []} saving={savingPhoto} seen={seenFull} onSeen={(k) => setSeenFull((x) => ({ ...x, [k]: true }))} onAccept={acceptPhoto} onReject={rejectOne} onNote={noteOne} onDish={(p, d) => void markDish(p, d)} canRestore={canMark} onRestore={(p) => void restorePhoto(p)} />
                  </Fold>
                ) : null}
              </div>
            </div>
            {/* pressed by mistake once, so Take down sits last, under the rows and apart from the everyday buttons */}
            {!dead && (!open || up) ? (
              <div className="mt-6 border-t border-line pt-4" data-takedown-zone>
                <button type="button" disabled={busy} onClick={() => setAsk((a) => (a === "takedown" ? null : "takedown"))} className={btnDanger} aria-expanded={ask === "takedown"}>
                  Take down
                </button>
                {ask === "takedown" ? (
            <div className="mt-3 flex max-w-xl flex-col gap-2 rounded-xl border border-line bg-panel p-3" data-takedown-box>
              <p className="text-sm text-ink">{c.url ? "It comes off the web on the publisher's next run." : "It is not on the web now."} You can undo this later.</p>
              <label className="text-xs font-medium text-muted" htmlFor={`sample-takedown-${c.id}`}>
                Why? (optional)
              </label>
              <textarea id={`sample-takedown-${c.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={REASON_MAX} rows={2} className={`${control} h-auto py-2`} />
              <label className="flex min-h-11 items-center gap-2 text-sm text-ink">
                <input type="checkbox" className="size-4 accent-[var(--color-accent)]" checked={asked} onChange={(e) => setAsked(e.target.checked)} />
                The business or a photographer asked for this
              </label>
              <button type="button" disabled={busy} onClick={() => void act("takedown")} className={btnDanger}>
                Take down this sample
              </button>
            </div>
          ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className={`order-2 min-w-0 ${view === "phone" ? "lg:sticky lg:top-4 lg:order-none lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start" : ""}`} data-preview-column>
          {/* the page at its real size: a phone (390 wide), or the full width of this column */}
          <div className="min-w-0">
            {view === "phone" ? (
              <div className="mx-auto w-full max-w-[24.5rem] md:w-[25.625rem] md:max-w-none">
              {switches}
              <div className="w-full rounded-[2.25rem] border-[10px] border-ink/85 bg-ink/85 shadow-lg" data-preview="phone">
                <iframe
                  title={`The sample page for ${c.business}, version ${c.version}${pg ? `, its ${pg} page` : ""}`}
                  src={`/api/samples/${c.id}/preview?v=${c.version}&finger=1${pg ? `&page=${encodeURIComponent(pg)}` : ""}`}
                  sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                  className="block h-[min(46rem,75vh)] w-full rounded-[1.6rem] border-0 bg-white lg:h-[min(52.75rem,calc(100vh-2rem-20px-3.375rem))]"
                />
              </div>
              </div>
            ) : (
              // the wide view in a laptop's frame, at a laptop's proportions
              <div className="mx-auto w-full max-w-[64rem] px-[5.4%]" data-preview="wide">
                {switches}
                <div className="rounded-t-[1.25rem] border-[10px] border-b-[14px] border-ink/85 bg-ink/85 shadow-lg">
                  <iframe
                    title={`The sample page for ${c.business}, version ${c.version}${pg ? `, its ${pg} page` : ""}`}
                    src={`/api/samples/${c.id}/preview?v=${c.version}${pg ? `&page=${encodeURIComponent(pg)}` : ""}`}
                    sandbox="allow-scripts allow-popups allow-popups-to-escape-sandbox"
                    className="block aspect-[16/10] max-h-[70vh] w-full rounded-[0.5rem] border-0 bg-white"
                  />
                </div>
                <div className="mx-auto h-3 w-[112%] -translate-x-[5.4%] rounded-b-xl bg-ink/70" aria-hidden />
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}

/** Each photo the page uses, as a picture, with Accept and Reject under the four rules, said once. */
const NOT_A_DISH = "__none__";
const seenKey = (p: Pick<ReviewPhoto, "full" | "fullAt">) => `${p.full}:${p.fullAt}`;

function PhotoChecks({ sampleId, rows, choices, saving, seen, onSeen, onAccept, onReject, onNote, onDish, canRestore, onRestore }: { sampleId: string; rows: ReviewPhoto[]; choices: string[]; saving: string; seen: Record<string, true>; onSeen: (key: string) => void; onAccept: (p: ReviewPhoto) => void; onReject: (p: ReviewPhoto) => void; onNote: (p: ReviewPhoto, note: string) => void; onDish: (p: ReviewPhoto, dish: string | null) => void; canRestore: boolean; onRestore: (p: ReviewPhoto) => void }) {
  const router = useRouter();
  const guests = rows.filter((p) => p.guest).length;
  const [viewing, setViewing] = useState<string | null>(null);
  const open = rows.find((p) => p.base === viewing) ?? null;
  const choice = "inline-flex min-h-11 items-center justify-center rounded-lg border px-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <div data-photo-checks>
      <p data-photo-rules>{PHOTO_RULES}</p>
      {guests ? (
        <p className="mt-1 text-muted">
          {guests === 1 ? "1 photo is a guest's" : `${guests} photos are a guest's`}, not the business&apos;s own: ask the business to swap {guests === 1 ? "it" : "them"} before the site goes live.
        </p>
      ) : null}
      <ul className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(min(13rem,100%),1fr))] gap-3">
        {rows.map((p) => {
          const src = `/api/samples/${sampleId}/photos/${encodeURIComponent(p.file)}`;
          const accepted = !p.rejected && isChecked(p.checks);
          const off = saving === p.base;
          const looked = !!seen[seenKey(p)];
          const name = p.dish || p.base;
          const options = p.dish && !choices.includes(p.dish) ? [p.dish, ...choices] : choices;
          return (
            <li key={p.base} className={`rounded-lg border bg-panel p-2 ${p.rejected ? "border-bad" : accepted ? "border-line" : "border-accent/50"}`} data-photo={p.base} data-decision={p.rejected ? "rejected" : accepted ? "accepted" : "open"}>
              <button type="button" onClick={() => setViewing(p.base)} aria-label={`Open ${name} at full size`} className="relative block w-full overflow-hidden rounded-md bg-bg" data-photo-open>
                {/* eslint-disable-next-line @next/next/no-img-element -- a private picture behind the sign-in, not for next/image */}
                <img src={src} alt={`${p.guest ? "Guest" : "Listing"} photo: ${name}`} loading="lazy" className="aspect-[4/3] w-full object-contain" />
                <span className="absolute right-1 bottom-1 rounded bg-black/75 px-1.5 py-0.5 text-xs font-medium text-white">{looked ? "Seen at full size" : "Open full size"}</span>
              </button>
              <p className="mt-1 truncate text-xs text-muted">
                {p.guest ? "Guest photo" : "Listing photo"} · {p.dish || p.base}
              </p>
              {p.graded ? (
                <p className="mt-1 flex flex-wrap items-center justify-between gap-x-2 text-xs text-muted" data-photo-graded>
                  Colour graded, same picture.
                  {canRestore ? (
                    <button type="button" disabled={off} onClick={() => onRestore(p)} className="inline-flex min-h-11 items-center font-medium text-accent-ink hover:underline disabled:opacity-50" data-photo-restore>
                      Restore original
                    </button>
                  ) : null}
                </p>
              ) : null}
              {p.reopened && !accepted && !p.rejected ? <p className="mt-1 text-xs font-medium text-ink" data-photo-reopened>{REOPEN_NOTE}</p> : null}
              <div className="mt-2 grid grid-cols-2 gap-2">
                <button type="button" aria-pressed={accepted} disabled={off} onClick={() => !accepted && onAccept(p)} className={`${choice} ${accepted ? "border-accent bg-accent-tint text-accent-ink" : "border-line text-ink hover:border-accent"}`} data-photo-accept>
                  Accept
                </button>
                <button type="button" aria-pressed={!!p.rejected} disabled={off} onClick={() => !p.rejected && onReject(p)} className={`${choice} ${p.rejected ? "border-bad text-bad" : "border-line text-ink hover:border-bad"}`} data-photo-reject>
                  Reject
                </button>
              </div>
              <DishPick key={`${p.base}:${p.dish}:${p.dishSet}`} p={p} name={name} options={options} onDish={onDish} />
              {p.rejected ? (
                <div className="mt-2">
                  <label className="block text-xs font-medium text-muted" htmlFor={`photo-note-${sampleId}-${p.base}`}>
                    What is wrong? (optional)
                  </label>
                  <textarea id={`photo-note-${sampleId}-${p.base}`} defaultValue={p.note ?? ""} maxLength={REJECT_NOTE_MAX} rows={2} onBlur={(e) => onNote(p, e.target.value)} className={`${control} mt-1 h-auto w-full py-2`} data-photo-note />
                  {p.onWeb ? (
                    <p className="mt-1 text-xs text-ink" data-photo-on-web>
                      This photo is on the live page. It stays up until a version without it is approved. If it must go now, use Take down.
                    </p>
                  ) : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {open ? (
        <PhotoViewer
          key={seenKey(open)}
          src={`/api/samples/${sampleId}/photos/${encodeURIComponent(open.full)}?view=full`}
          title={`${open.guest ? "Guest" : "Listing"} photo: ${open.dish || open.base}`}
          accepted={!open.rejected && isChecked(open.checks)}
          rejected={!!open.rejected}
          busy={saving === open.base}
          onSeen={() => onSeen(seenKey(open))}
          onAccept={() => onAccept(open)}
          onReject={() => onReject(open)}
          onClose={() => setViewing(null)}
          onRequestEdit={async (text) => {
            const form = new FormData();
            form.set("text", `Edit the photo "${open.dish || open.base}" (${open.file}): ${text}`);
            const r = await fetch(`/api/samples/${sampleId}/requests`, { method: "POST", body: form });
            const d = (await r.json().catch(() => ({}))) as { ok?: boolean; error?: string };
            if (!r.ok || !d.ok) return d.error ?? "Not sent.";
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </div>
  );
}

const OTHER_DISH = "__other__";
/** What a photo shows, from the lead's own items or a name the person types under "Other". */
function DishPick({ p, name, options, onDish }: { p: ReviewPhoto; name: string; options: string[]; onDish: (p: ReviewPhoto, dish: string | null) => void }) {
  const [typing, setTyping] = useState(false);
  const [text, setText] = useState("");
  const typed = text.replace(/\s+/g, " ").trim();
  const save = () => {
    if (!typed || /[<>]/.test(typed)) return;
    setTyping(false);
    setText("");
    if (typed !== p.dish || !p.dishSet) onDish(p, typed);
  };
  return (
    <div className="mt-2">
      <label className="block text-xs font-medium text-muted">
        This photo shows:
        <select
          value={typing ? OTHER_DISH : p.dishSet ? p.dish || NOT_A_DISH : ""}
          onChange={(e) => {
            const v = e.target.value;
            if (v === OTHER_DISH) return setTyping(true);
            setTyping(false);
            onDish(p, v === NOT_A_DISH ? null : v);
          }}
          className={`${control} mt-1 w-full`}
          data-photo-dish
        >
          {p.dishSet || typing ? null : (
            <option value="" disabled>
              Choose…
            </option>
          )}
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
          <option value={NOT_A_DISH}>None of these / not a dish</option>
          <option value={OTHER_DISH}>Other: type a name…</option>
        </select>
      </label>
      {typing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="mt-2 flex gap-2"
          data-photo-dish-other
        >
          <input
            // eslint-disable-next-line jsx-a11y/no-autofocus -- the person just chose "Other: type a name", so the box is where they type next
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setTyping(false)}
            maxLength={DISH_MAX}
            placeholder="Name of the dish"
            aria-label={`What ${name} shows`}
            className={`${control} min-w-0 flex-1`}
            data-photo-dish-text
          />
          <button type="submit" disabled={!typed || /[<>]/.test(typed)} className={`${btnOutline} min-h-11 shrink-0`} data-photo-dish-save>
            Save
          </button>
        </form>
      ) : null}
    </div>
  );
}

function RequestItem({ sampleId, r, draftedBy, version, canClose }: { sampleId: string; r: CardRequest; draftedBy: string; version: number; canClose: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // the person who filed it, the owner or a manager ends it; the server checks the same
  const claimed = r.status === "addressed";
  const close = async (action: "done" | "withdraw" | "not-done") => {
    const ask = action === "not-done" ? "Send this request back as not done?" : action === "withdraw" ? "Withdraw this request?" : claimed ? `Confirm this was done in version ${r.answeredVersion}?` : `Close this request as done in version ${version}?`;
    if (!window.confirm(ask)) return;
    setBusy(true);
    setMsg("");
    try {
      const res = await fetch(`/api/samples/${sampleId}/requests/${r.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const d = (await res.json()) as { ok: boolean; error?: string };
      if (!d.ok) setMsg(d.error ?? "Not saved.");
      else router.refresh();
    } catch {
      setMsg("No answer from the server.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-lg bg-bg px-3 py-2" data-request={r.status}>
      <p className="whitespace-pre-line text-ink">{r.text}</p>
      {r.pictures.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {r.pictures.map((n) => (
            <a key={n} href={`/api/samples/${sampleId}/requests/${r.id}/pictures/${n}`} target="_blank" rel="noopener" className="block size-20 overflow-hidden rounded-md border border-line bg-white">
              {/* eslint-disable-next-line @next/next/no-img-element -- a private picture behind the sign-in, not for next/image */}
              <img src={`/api/samples/${sampleId}/requests/${r.id}/pictures/${n}`} alt={`Attachment ${n} of this request`} className="size-full object-cover" loading="lazy" />
            </a>
          ))}
        </div>
      ) : null}
      <p className="mt-1 text-xs text-muted">
        {r.by ? agentName(r.by) : "Someone"} · <span suppressHydrationWarning>{when(r.at)}</span> · made on version {r.madeOn} ·{" "}
        {/* who has it now, from what Peek knows; never a guess */}
        <span className="font-semibold text-ink" data-request-state>{requestState(r, draftedBy)}</span>
      </p>
      {claimed ? (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-request-claimed>
          {canClose ? (
            <button type="button" disabled={busy} onClick={() => void close("done")} className={btnOutline} data-claim-done>
              Yes, it is done
            </button>
          ) : null}
          <button type="button" disabled={busy} onClick={() => void close("not-done")} className={btnOutline} data-claim-not-done>
            Not done
          </button>
          {msg ? <span role="status" className="text-xs text-bad">{msg}</span> : null}
        </div>
      ) : null}
      {r.status === "open" && canClose ? (
        <div className="mt-2 flex flex-wrap items-center gap-2" data-request-close>
          <button type="button" disabled={busy} onClick={() => void close("done")} className={btnOutline} data-close-done>
            Done in version {version}
          </button>
          <button type="button" disabled={busy} onClick={() => void close("withdraw")} className={btnOutline} data-close-withdraw>
            Withdraw
          </button>
          {msg ? <span role="status" className="text-xs text-bad">{msg}</span> : null}
        </div>
      ) : null}
    </li>
  );
}

/** The Reference mark row. The switch and the badge stay in the title line; open, the kind of business it
 *  stands for, what it means and the pinned note. The mark follows the approved version, never a draft's. */
function ReferenceRow({ c, canMark, mark, open, onToggle }: { c: SampleCard; canMark: boolean; mark: Mark | null; open: boolean; onToggle: () => void }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const markable = c.approvedVersion !== null && c.status !== "taken_down" && c.status !== "rejected";
  if (!mark && !(canMark && markable)) return null;
  const send = async (body: Record<string, unknown>) => {
    setBusy(true);
    setMsg("");
    try {
      const r = await fetch(`/api/samples/${c.id}/reference`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const d = (await r.json()) as { ok: boolean; error?: string };
      if (!d.ok) setMsg(d.error ?? "Not saved.");
      else router.refresh();
    } catch {
      setMsg("No answer from the server.");
    } finally {
      setBusy(false);
    }
  };
  const stale = !!mark && c.approvedVersion !== null && mark.version !== c.approvedVersion;
  // the mark pins the approved version, so with a newer draft the row says which one before the click
  const wouldMark = !mark && markable && c.approvedVersion !== c.version ? `Reference site: would mark approved version ${c.approvedVersion}` : null;
  return (
    <Fold
      name="reference"
      open={open}
      onToggle={onToggle}
      title={
        mark ? (
          <>
            Reference · version {mark.version} · {FAMILY_LABEL[mark.family] ?? mark.family}
            {stale ? <span className="font-normal text-muted"> · pinned to version {mark.version}; now version {c.approvedVersion}</span> : null}
          </>
        ) : (
          (wouldMark ?? "Reference site")
        )
      }
      aside={
        canMark && markable ? (
          <button
            type="button"
            role="switch"
            aria-checked={!!mark}
            aria-label={wouldMark ?? "Reference site"}
            disabled={busy}
            onClick={() => void send(mark ? { action: "clear" } : { action: "set" })}
            className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center disabled:opacity-50"
            data-reference={mark ? mark.version : undefined}
          >
            <span aria-hidden className={`relative inline-block h-6 w-10 rounded-full transition-colors ${mark ? "bg-accent" : "bg-line"}`}>
              <span className={`absolute top-0.5 size-5 rounded-full bg-white shadow transition-[left] ${mark ? "left-[1.125rem]" : "left-0.5"}`} />
            </span>
          </button>
        ) : null
      }
    >
      {mark && canMark ? (
        <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
          Stands for
          <select value={mark.family} disabled={busy} onChange={(e) => void send({ action: "family", family: e.target.value })} className={`${control} h-11 w-auto py-0 text-sm`}>
            {Object.entries(FAMILY_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <p className="mt-1 text-xs text-muted">
        {mark ? "New sites of this kind must pass its content (what it says and shows); their design can differ." : "Mark it, and new sites of its kind must pass its content; their design can differ."}
        {mark ? (
          <>
            {" "}
            Marked by {mark.setBy || "the owner"}
            {mark.setAt ? <span suppressHydrationWarning>, {when(mark.setAt)}</span> : null}.
          </>
        ) : null}
      </p>
      {wouldMark ? <p className="mt-1 text-xs text-ink" data-reference-draft>Version {c.version} is still a draft. Approve it first to mark that one instead.</p> : null}
      {stale && canMark && markable ? (
        <button type="button" disabled={busy} onClick={() => void send({ action: "set", family: mark!.family })} className={btnText}>
          Move the mark to version {c.approvedVersion}
        </button>
      ) : null}
      {msg ? (
        <p role="status" className="text-sm text-bad">
          {msg}
        </p>
      ) : null}
    </Fold>
  );
}
