// Browser-side calls to this app's write endpoints (run/stop, persona). They must send JSON from this page's
// own origin, which lib/same-origin.ts checks.
import { errorText } from "./format";

export type Sent<T> = { ok: boolean; status: number; body: T | null; error: string | null };

export async function sendJson<T>(url: string, method: "POST" | "PUT", payload: unknown): Promise<Sent<T>> {
  try {
    const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = (await res.json().catch(() => null)) as T | null;
    return { ok: res.ok, status: res.status, body, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, status: 0, body: null, error: errorText(err) };
  }
}
