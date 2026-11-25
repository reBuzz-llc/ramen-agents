// The board's fingerprint, held a minute for bot writes. Bots write the board all day; each
// write changed the fingerprint, so the next Leads visit rebuilt every row (~2.7 MB as text) and the browser fetched them
// all again. Now a company's fingerprint is kept for up to a minute: a bot's write shows at most a minute later, and in
// the meantime a visit costs no fingerprint query and no rebuild. A person's own write (an edit, a clear, an import, taking
// or giving back a lead) drops it at once, so their change shows on their next view. No imports from the store, so both
// the store (lib/leads.ts, lib/claims.ts) and the cache (lib/board-cache.ts) can use it.

/** How long a fingerprint stands for bot writes (ms). */
export const BOT_WRITE_WINDOW_MS = 60_000;

const g = globalThis as { __boardFp?: Map<string, { fp: string; at: number }> };
const store = () => (g.__boardFp ??= new Map());

/** The company's fingerprint: the held one while it is under a minute old, else a fresh read (kept for the next minute). */
export async function heldFingerprint(tenantId: string, read: () => Promise<string>, now = Date.now()): Promise<string> {
  const got = store().get(tenantId);
  if (got && now - got.at < BOT_WRITE_WINDOW_MS) return got.fp;
  const fp = await read();
  store().set(tenantId, { fp, at: now });
  return fp;
}

/** A person wrote the company's board: the next read is fresh. */
export function dropFingerprint(tenantId: string): void {
  store().delete(tenantId);
}
