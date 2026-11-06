"use client";
// What the Asset and Packages pages share: saving a
// list as edited, moving a row, a row's tools and the "last changed" line.
import { btnDanger, btnOutline } from "@/lib/ui-classes";

export const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
let seq = 0;
export const newKey = () => `n${++seq}`;

/** Save a list as edited; `known` is the ids this page loaded, so a draft a bot handed over meanwhile is kept. */
export async function save(list: "rates" | "packages" | "sections", items: object[], known: string[]): Promise<{ ok: boolean; error?: string }> {
  try {
    const r = await fetch(`/api/assets/${list}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ [list]: items, known }) });
    return await r.json();
  } catch {
    return { ok: false, error: "No answer from the server." };
  }
}

export function move<T>(list: T[], i: number, by: -1 | 1): T[] {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Up, down and remove for one row of an edited list. */
export function RowTools({ i, count, what, onMove, onRemove }: { i: number; count: number; what: string; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <button type="button" className={`${btnOutline} w-11 px-0`} aria-label={`Move ${what} up`} disabled={i === 0} onClick={() => onMove(-1)}>
        ↑
      </button>
      <button type="button" className={`${btnOutline} w-11 px-0`} aria-label={`Move ${what} down`} disabled={i === count - 1} onClick={() => onMove(1)}>
        ↓
      </button>
      <button type="button" className={`${btnDanger} px-2`} aria-label={`Remove ${what}`} onClick={onRemove}>
        Remove
      </button>
    </span>
  );
}

export function Updated({ rows }: { rows: { updatedAt: string; updatedBy: string }[] }) {
  const last = rows.reduce<{ updatedAt: string; updatedBy: string } | null>((m, r) => (!m || r.updatedAt > m.updatedAt ? r : m), null);
  return last ? (
    <p className="mt-3 text-xs text-muted">
      Last changed {day(last.updatedAt)}
      {last.updatedBy ? ` by ${last.updatedBy}` : ""}.
    </p>
  ) : null;
}
