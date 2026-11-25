// How the app's database pool behaves. On Vercel the team was soft-blocked on 2026-11-15 for function
// duration: a five-minute idle timeout with attachDatabasePool made Vercel keep each function alive (waitUntil) until the
// pool's idle clients closed, so every request that touched the database was billed about 300 s. On Vercel the idle
// timeout is now short and the pool is not attached (a frozen instance's clients simply wait for the next request); off
// Vercel (Peek on the Mac) the long-lived pool stays: from the Mac every new TLS connection to ap-southeast-2 costs about
// half a second.

/** The longest idle time a pooled connection may have on Vercel (ms): a test pins it so it cannot creep back. */
export const VERCEL_IDLE_MAX_MS = 10_000;

export type PoolPlan = { max: number; min: number; idleTimeoutMillis: number; keepAlive: boolean; keepAliveInitialDelayMillis: number; attachToVercel: boolean };

/** The pool for where the app runs: `env.VERCEL` set means a Vercel function. */
export function poolOptions(env: Record<string, string | undefined>): PoolPlan {
  if (env.VERCEL) return { max: 5, min: 0, idleTimeoutMillis: 5_000, keepAlive: false, keepAliveInitialDelayMillis: 0, attachToVercel: false };
  // The Mac's connections to Supabase's pooler died silently while idle (20 "read ETIMEDOUT" in
  // peek-supabase.err, 7 of them uncaught; the board read as down to the family): a keep-alive probe after 10 s idle finds
  // a dead socket before a query does, and an idle connection closes after a minute (a new one costs ~0.5 s)
  // Two stay open through a quiet minute, so the first click after a pause does not pay for a new connection
  return { max: 5, min: 2, idleTimeoutMillis: 60_000, keepAlive: true, keepAliveInitialDelayMillis: 10_000, attachToVercel: false };
}

/** The pool's one line for an idle client's error (pg drops that client itself): an ISO time first, so an outage can be
 *  matched to a clock; the error's code and message only, never the connection's settings. */
export function poolErrorLine(err: unknown, now = new Date()): string {
  const e = err as { code?: unknown; message?: unknown } | null;
  return `${now.toISOString()} peek db pool: idle connection error ${String(e?.code ?? "")} ${String(e?.message ?? err).slice(0, 160)}`.replace(/\s+/g, " ").trim();
}

/** A connection that timed out or was reset under a query. */
const RETRY_CODES = new Set(["ETIMEDOUT", "ECONNRESET"]);
/** Only a read is ever retried: a plain SELECT (never a write, never a statement that could have changed something). */
export const isRead = (q: unknown) => /^\s*select\b/i.test(typeof q === "string" ? q : String((q as { text?: unknown } | null)?.text ?? ""));
type Query = (...a: unknown[]) => Promise<unknown>;
/** pool.query that runs a read once more when its connection timed out or was reset (pg has dropped that client, so the
 *  second try gets a fresh one); a write, a callback call or any other error goes straight through. */
export function withReadRetry(query: Query, log: (line: string) => void = (l) => console.error(l)): Query {
  return (...a: unknown[]) => {
    const p = query(...a);
    if (typeof a[a.length - 1] === "function" || !isRead(a[0])) return p;
    return p.catch((err: { code?: string }) => {
      if (!RETRY_CODES.has(String(err?.code))) throw err;
      log(`${new Date().toISOString()} peek db pool: read retried once after ${err.code}`);
      return query(...a);
    });
  };
}
