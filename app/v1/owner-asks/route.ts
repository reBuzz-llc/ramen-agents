import { NextResponse } from "next/server";
import { body, fail, failed, keyed, metered } from "@/lib/board-api";
import { AskError, fileAsk, readAsk } from "@/lib/owner-asks";

// POST (board:write) files a proposal for the owner: {kind, subject, target, title, text,
// channel}. It can never approve. GET ?kind=&subject= (board:read): {found: true, kind, subject, target, textHash, byOwner, person,
// at, withdrawn, withdrawnAt, usedAt}, or {found: false}. Any other answer is an error, and a reader must refuse to act on it.
const asked = (err: unknown, where: string) => (err instanceof AskError ? fail(err.status, err.status === 409 ? "conflict" : err.status === 404 ? "not_found" : "bad_request", err.message) : failed(err, where));

export async function POST(req: Request) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b) return fail(400, "bad_request", "send {kind, subject, target, title, text, channel}");
  try {
    return NextResponse.json({ ask: await fileAsk(k.d, k.key.tenantId, b, k.key.name) });
  } catch (err) {
    return asked(err, "v1.owner-asks");
  }
}

export async function GET(req: Request) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const q = new URL(req.url).searchParams;
  try {
    return await metered(k.d, k.key, await readAsk(k.d, k.key.tenantId, q.get("kind"), q.get("subject")), { "cache-control": "no-store" });
  } catch (err) {
    return asked(err, "v1.owner-asks.read");
  }
}
