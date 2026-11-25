// What a take-down leaves behind so it can be undone: who took the sample
// down and when, the optional reason, whether the business or a photographer asked for it, and the Reference mark it removed.
// Stored in the tenant's settings beside the marks themselves, so no migration. Pure, so the store, the page and the tests share it.

export type TakedownMark = { version: number; family: string; setAt: string; setBy: string };
export type TakedownRecord = {
  sampleId: string;
  reason: string;
  /** The business or a photographer asked for it: putting it back needs a person to say they checked with them. */
  asked: boolean;
  by: string;
  at: string;
  reference?: TakedownMark;
  undoneBy?: string;
  undoneAt?: string;
};

export const TAKEDOWN_LOG = 200;
export const REASON_MAX = 300;

export const cleanReason = (raw: unknown) => (typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, REASON_MAX) : "");

/** The sample's take-down that has not been undone, newest first; null when Peek holds none (one from before take-downs were recorded). */
export function openTakedown(log: TakedownRecord[] | null | undefined, sampleId: string): TakedownRecord | null {
  const list = Array.isArray(log) ? log : [];
  for (let i = list.length - 1; i >= 0; i--) if (list[i].sampleId === sampleId) return list[i].undoneAt ? null : list[i];
  return null;
}

/** The log with this take-down added, oldest entries dropped past the cap. A sample already down keeps its first record. */
export function withTakedown(log: TakedownRecord[] | null | undefined, entry: TakedownRecord): TakedownRecord[] {
  const list = Array.isArray(log) ? log : [];
  return openTakedown(list, entry.sampleId) ? list : [...list, entry].slice(-TAKEDOWN_LOG);
}

/** The log with who undid this sample's take-down and when; a sample from before take-downs were recorded gets a line of its own. */
export function withUndo(log: TakedownRecord[] | null | undefined, sampleId: string, by: string, at: string): TakedownRecord[] {
  const list = Array.isArray(log) ? log : [];
  const open = openTakedown(list, sampleId);
  if (!open) return [...list, { sampleId, reason: "", asked: false, by: "", at: "", undoneBy: by, undoneAt: at }].slice(-TAKEDOWN_LOG);
  return list.map((r) => (r === open ? { ...r, undoneBy: by, undoneAt: at } : r));
}
