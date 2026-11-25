"use client";

import { useLayoutEffect, type RefObject } from "react";
import { hasPictures, isDocsPaste, PICTURES_NOTE } from "@/lib/rich-text";

/** The cleaner loads on the first paste, so the board does not carry it. */
export const cleanPaste = (raw: string) => import("@/lib/rich-clean").then((m) => m.cleanRich(raw));

/** A saved document, as it looked in the Google Doc: on white, since its own colours are written for a white page. The HTML
 *  has been through lib/rich-clean.ts on the server. */
export function RichBody({ html }: { html: string }) {
  return <div data-rich className="rich-doc overflow-x-auto rounded-lg bg-white p-3 text-black" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** Editing a formatted cell. It keeps its own content while typing; Save reads it from `editorRef`. A further paste from a Google
 *  Doc is cleaned and keeps its formatting, any other paste comes in as plain text, and nothing can be dropped in. */
export function RichEditor({ initial, label, editorRef, onNote }: { initial: string; label: string; editorRef: RefObject<HTMLDivElement | null>; onNote: (note: string) => void }) {
  useLayoutEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = initial;
    el.focus({ preventScroll: true });
    const end = document.createRange();
    end.selectNodeContents(el);
    end.collapse(false);
    const s = window.getSelection();
    s?.removeAllRanges();
    s?.addRange(end);
  }, [editorRef, initial]);
  const paste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const raw = e.clipboardData.getData("text/html");
    const text = e.clipboardData.getData("text/plain");
    if (!isDocsPaste(raw)) {
      document.execCommand("insertText", false, text);
      return;
    }
    void cleanPaste(raw)
      .then((clean) => {
        document.execCommand("insertHTML", false, clean);
        if (hasPictures(raw)) onNote(PICTURES_NOTE);
      })
      .catch(() => document.execCommand("insertText", false, text));
  };
  return (
    <div
      ref={editorRef}
      data-rich-editor
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      tabIndex={0}
      contentEditable
      suppressContentEditableWarning
      onPaste={paste}
      onDrop={(e) => e.preventDefault()}
      className="rich-doc max-h-[60vh] min-h-32 overflow-auto rounded-lg border border-accent bg-white p-3 text-black"
    />
  );
}

/** Copies both forms: a mail or a document takes the formatted one, anything else the plain one. */
export async function copyRich(html: string, plain: string): Promise<boolean> {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }), "text/plain": new Blob([plain], { type: "text/plain" }) })]);
    return true;
  } catch {
    try {
      await navigator.clipboard.writeText(plain);
      return true;
    } catch {
      return false;
    }
  }
}
