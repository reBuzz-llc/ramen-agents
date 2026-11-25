// A speed-up with one caution: a cached login check must never outlive a sign-out or a role change.
// This is not a cached login. Every request still runs the full check against the database. The hint only says whose reads to
// START while that check is on its way, so the two share one trip to the database instead of taking two in a row. Nothing read
// under a hint is used unless the check passes for the same person and company.
import { sha256 } from "./crypto";

export type Hint = { userId: string; tenantId: string };

const MAX = 500;
const g = globalThis as { __peekSessionHints?: Map<string, Hint> };
const hints = () => (g.__peekSessionHints ??= new Map());

/** After a check: remember who this session was, or forget it when the check found no one. Only the token's hash is kept. */
export function rememberHint(token: string | undefined, who: Hint | null): void {
  if (!token) return;
  const key = sha256(token);
  const all = hints();
  all.delete(key);
  if (!who) return;
  all.set(key, { userId: who.userId, tenantId: who.tenantId });
  while (all.size > MAX) all.delete(all.keys().next().value!);
}

export const hintFor = (token: string | undefined): Hint | null => (token ? (hints().get(sha256(token)) ?? null) : null);

/** Run the check and the reads together when a hint is there. The reads are returned only if the check passes for the hinted
 *  person and company; for anyone else they are thrown away and read again as the person the check found. A check that
 *  answers null or throws (a redirect to sign-in) returns no data at all. */
export async function readsWith<W extends Hint, T>(hint: Hint | null, check: () => Promise<W | null>, read: (who: Hint) => Promise<T>): Promise<{ who: W; data: T } | null> {
  const early = hint ? read(hint) : null;
  early?.catch(() => undefined); // a failed early read is reported only if its result is used below
  const who = await check();
  if (!who) return null;
  const same = !!hint && hint.userId === who.userId && hint.tenantId === who.tenantId;
  return { who, data: await (same && early ? early : read({ userId: who.userId, tenantId: who.tenantId })) };
}
