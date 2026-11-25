"use client";

import { useEffect, useRef, useState } from "react";
import { PHOTO_CHECKS } from "@/lib/sample-photo-checks";
import { btnOutline, control } from "@/lib/ui-classes";

/** The longest edit request typed here; the photo's name goes in front, within the request's 1000 characters. */
export const EDIT_MAX = 800;

const ZOOMS = [
  { key: "fit", label: "Fit", scale: 0 },
  { key: "100", label: "100%", scale: 1 },
  { key: "200", label: "200%", scale: 2 },
] as const;

/** The largest stored file of one photo, with the four checks beside it. A face or a number can be clear only at this
 *  size, so Accept waits for this picture to arrive. Drag or scroll to pan; on a phone, pinch works too. Below the
 *  answers, a box asks for an edit to this photo: it is sent as a change request on the sample, naming the photo. */
export default function PhotoViewer({ src, title, accepted, rejected, busy, onSeen, onAccept, onReject, onClose, onRequestEdit }: { src: string; title: string; accepted: boolean; rejected: boolean; busy: boolean; onSeen: () => void; onAccept: () => void; onReject: () => void; onClose: () => void; /** Sends the edit request; answers an error to show, or null once it is sent. */ onRequestEdit?: (text: string) => Promise<string | null> }) {
  const box = useRef<HTMLDialogElement>(null);
  const pane = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]["key"]>("fit");
  const [natural, setNatural] = useState(0);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [edit, setEdit] = useState("");
  const [sending, setSending] = useState(false);
  const [editMsg, setEditMsg] = useState<{ ok: boolean; text: string } | null>(null);
  useEffect(() => {
    const d = box.current;
    if (d && !d.open) d.showModal();
  }, []);
  const scale = ZOOMS.find((z) => z.key === zoom)?.scale ?? 0;
  const button = "inline-flex min-h-11 items-center justify-center rounded-lg border px-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
  return (
    <dialog ref={box} onClose={onClose} aria-label={`${title}, full size`} data-photo-viewer className="fixed inset-0 m-0 h-dvh max-h-none w-full max-w-none bg-bg p-0 text-ink backdrop:bg-ink/60">
      <div className="grid h-full grid-rows-[minmax(0,1fr)_auto] lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-1">
        <div
          ref={pane}
          data-photo-pane
          className={`relative overflow-auto bg-black ${scale ? "cursor-grab" : ""}`}
          style={{ touchAction: "pan-x pan-y pinch-zoom" }}
          onPointerDown={(e) => {
            if (!scale || e.pointerType !== "mouse" || !pane.current) return;
            drag.current = { x: e.clientX, y: e.clientY, left: pane.current.scrollLeft, top: pane.current.scrollTop };
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current || !pane.current) return;
            pane.current.scrollLeft = drag.current.left - (e.clientX - drag.current.x);
            pane.current.scrollTop = drag.current.top - (e.clientY - drag.current.y);
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element -- a private picture behind the sign-in, not for next/image */}
          <img
            src={src}
            alt={`${title}, full size`}
            draggable={false}
            onLoad={(e) => {
              setNatural(e.currentTarget.naturalWidth);
              setState("ready");
              onSeen();
            }}
            onError={() => setState("failed")}
            className={scale ? "max-w-none" : "mx-auto h-full w-full object-contain"}
            style={scale && natural ? { width: natural * scale } : undefined}
          />
          {state === "loading" ? <p role="status" className="absolute inset-x-0 top-4 text-center text-sm text-white">Loading the full-size photo…</p> : null}
          {state === "failed" ? <p role="alert" className="absolute inset-x-4 top-4 rounded-lg bg-panel p-3 text-center text-sm text-bad">The full-size photo did not load, so it cannot be accepted yet. Close this and try again.</p> : null}
        </div>
        <div className="max-h-[42dvh] overflow-y-auto border-t border-line bg-panel p-3 lg:max-h-none lg:border-t-0 lg:border-l lg:p-4">
          <div className="flex items-start justify-between gap-2">
            <h2 className="min-w-0 text-sm font-semibold break-words">{title}</h2>
            <button type="button" onClick={() => box.current?.close()} className="min-h-11 shrink-0 px-1 text-sm text-muted hover:text-ink">
              Close
            </button>
          </div>
          <div role="group" aria-label="Zoom" className="mt-1 grid grid-cols-3 gap-1">
            {ZOOMS.map((z) => (
              <button key={z.key} type="button" aria-pressed={zoom === z.key} onClick={() => setZoom(z.key)} className={`${button} ${zoom === z.key ? "border-accent bg-accent-tint text-accent-ink" : "border-line"}`}>
                {z.label}
              </button>
            ))}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-2 gap-y-1 text-sm lg:grid-cols-1" data-photo-rules-full>
            {PHOTO_CHECKS.map((c) => (
              <li key={c.key}>{c.label}</li>
            ))}
          </ul>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy || state !== "ready" || accepted}
              onClick={() => {
                onAccept();
                box.current?.close();
              }}
              className={`${button} border-accent bg-accent text-on-accent hover:bg-accent-hover`}
              data-viewer-accept
            >
              {accepted ? "Accepted" : "Accept"}
            </button>
            <button
              type="button"
              disabled={busy || rejected}
              onClick={() => {
                onReject();
                box.current?.close();
              }}
              className={`${button} border-line hover:border-bad`}
              data-viewer-reject
            >
              {rejected ? "Rejected" : "Reject"}
            </button>
          </div>
          {onRequestEdit ? (
            <form
              className="mt-4 border-t border-line pt-3"
              data-photo-edit
              onSubmit={async (e) => {
                e.preventDefault();
                const text = edit.trim();
                if (!text || sending) return;
                setSending(true);
                setEditMsg(null);
                const err = await onRequestEdit(text).catch(() => "Not sent: Peek could not be reached.");
                setSending(false);
                if (err) setEditMsg({ ok: false, text: err });
                else {
                  setEdit("");
                  setEditMsg({ ok: true, text: "Sent as a change request on this sample, naming this photo." });
                }
              }}
            >
              <label htmlFor="photo-edit-text" className="block text-sm font-medium">
                Ask for an edit to this photo
              </label>
              <textarea
                id="photo-edit-text"
                value={edit}
                onChange={(e) => setEdit(e.target.value)}
                maxLength={EDIT_MAX}
                rows={3}
                placeholder="For example: brighter, or crop out the sign on the left"
                className={`${control} mt-1 h-auto w-full py-2`}
                data-photo-edit-text
              />
              <button type="submit" disabled={sending || !edit.trim()} className={`${btnOutline} mt-2 min-h-11 w-full`} data-photo-edit-send>
                {sending ? "Sending…" : "Send edit request"}
              </button>
              {editMsg ? (
                <p role={editMsg.ok ? "status" : "alert"} className={`mt-2 text-sm ${editMsg.ok ? "text-muted" : "text-bad"}`} data-photo-edit-msg>
                  {editMsg.text}
                </p>
              ) : null}
            </form>
          ) : null}
        </div>
      </div>
    </dialog>
  );
}
