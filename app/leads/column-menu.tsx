"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { MenuAction, MenuItem } from "@/lib/table-columns";

/** Kept inside the window: opened below its anchor, moved up or left when it would not fit. */
function usePlaced(x: number, y: number) {
  const box = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState({ left: x, top: y });
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    // its size is known only once it is drawn
    setAt({ left: Math.max(8, Math.min(x, document.documentElement.clientWidth - r.width - 8)), top: Math.max(8, Math.min(y, window.innerHeight - r.height - 8)) });
  }, [x, y]);
  return { box, at };
}

function useDismiss(box: React.RefObject<HTMLDivElement | null>, onClose: () => void) {
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    document.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", onClose);
    };
  }, [box, onClose]);
}

/** A column heading's menu. It takes a list, so a new entry needs no new layout. Arrow keys move through it. */
export default function ColumnMenu({ label, items, x, y, onPick, onClose }: { label: string; items: MenuItem[]; x: number; y: number; onPick: (a: MenuAction) => void; onClose: () => void }) {
  const { box, at } = usePlaced(x, y);
  useDismiss(box, onClose);
  useEffect(() => box.current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true }), [box]);
  const move = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = [...(box.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    const i = all.indexOf(document.activeElement as HTMLButtonElement);
    all[(i + (e.key === "ArrowDown" ? 1 : -1) + all.length) % all.length]?.focus();
  };
  return (
    <div ref={box} role="menu" tabIndex={-1} aria-label={`${label} column`} onKeyDown={move} data-column-menu style={{ left: at.left, top: at.top }} className="fixed z-40 min-w-48 overflow-hidden rounded-xl border border-line bg-panel py-1 text-sm shadow-lg">
      {items.map((m) => (
        <div key={m.action}>
          {m.divider ? <div className="my-1 border-t border-line" /> : null}
          <button type="button" role={m.checked === undefined ? "menuitem" : "menuitemcheckbox"} aria-checked={m.checked} onClick={() => onPick(m.action)} data-menu-action={m.action} className="flex min-h-11 w-full items-center justify-between gap-4 px-3 text-left whitespace-nowrap hover:bg-accent-tint focus-visible:bg-accent-tint">
            {m.label}
            {m.checked ? <span aria-hidden className="font-semibold text-accent-ink">✓</span> : null}
          </button>
        </div>
      ))}
    </div>
  );
}

/** A wrapped cell's whole text, over the table. */
export function FullCell({ x, y, children, onOpen, onClose }: { x: number; y: number; children: ReactNode; onOpen: () => void; onClose: () => void }) {
  const { box, at } = usePlaced(x, y);
  useDismiss(box, onClose);
  return (
    <div ref={box} role="dialog" aria-label="Full text of this cell" data-full-cell style={{ left: at.left, top: at.top }} className="fixed z-40 w-[min(28rem,calc(100vw-1rem))] rounded-xl border border-line bg-panel p-3 text-sm shadow-lg">
      <div className="max-h-[50vh] overflow-y-auto break-words whitespace-pre-line">{children}</div>
      <div className="mt-2 flex justify-end gap-3 border-t border-line pt-1">
        <button type="button" onClick={onOpen} className="inline-flex min-h-11 items-center font-medium text-accent-ink hover:underline">
          Open lead
        </button>
        <button type="button" onClick={onClose} className="inline-flex min-h-11 items-center text-muted hover:text-ink">
          Close
        </button>
      </div>
    </div>
  );
}
