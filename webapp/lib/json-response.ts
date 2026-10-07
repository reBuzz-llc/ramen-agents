// Server-side only: JSON with gzip when the browser accepts it. `next start` does not compress route-handler
// responses here, and the pages poll every few seconds (Requests 130 KB every 5 s, 2026-10-05); text JSON shrinks ~10x.
import { gzipSync } from "node:zlib";

export function jsonResponse(req: Request, body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  const text = JSON.stringify(body);
  const headers: Record<string, string> = { "content-type": "application/json", "cache-control": "no-store", vary: "accept-encoding", ...init.headers };
  if (text.length > 2048 && /\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) {
    return new Response(gzipSync(text), { status: init.status ?? 200, headers: { ...headers, "content-encoding": "gzip" } });
  }
  return new Response(text, { status: init.status ?? 200, headers });
}
