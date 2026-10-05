"use client";

import { useEffect, useRef } from "react";

/**
 * A modal sheet (applebrandkit.md): slides up from the bottom with a grabber on phones, a centered card on
 * wide screens. Built on <dialog>, so focus stays inside, Escape closes it, and the page behind is inert.
 */
export default function Sheet({ open, onClose, title, children, wide = false }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-label={title}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && onClose()}
      className={`m-0 mt-auto w-full max-w-none bg-transparent p-0 text-ink backdrop:bg-black/35 backdrop:[animation:fade-in_0.2s_ease-out] sm:m-auto ${wide ? "sm:w-[min(40rem,calc(100vw-2rem))]" : "sm:w-[min(30rem,calc(100vw-2rem))]"}`}
    >
      <div className="pb-safe rounded-t-[1.375rem] bg-panel px-5 pt-2.5 pb-5 shadow-[0_-8px_40px_rgb(0_0_0/0.2)] [animation:sheet-up_0.4s_var(--ease-spring)] sm:rounded-[1.375rem] sm:pt-5 sm:[animation:menu-in_0.3s_var(--ease-spring)]">
        <div className="mx-auto mb-3 h-[5px] w-9 rounded-full bg-fill sm:hidden" aria-hidden />
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="pressable hit grid h-8 w-8 place-items-center rounded-full bg-fill-3 text-muted hover:text-ink" aria-label="Close">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
