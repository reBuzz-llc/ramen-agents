import { NextResponse } from "next/server";
import { body, fail, failed, keyed } from "@/lib/board-api";
import { AskError, spendAsk } from "@/lib/owner-asks";

// POST {kind, subject, textHash} (board:write): an approval was used, right after the post went out. Add-only, the first
// time stays, and only a live owner approval of the current words can be used. A key can use one up, never make one.
export async function POST(req: Request) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b) return fail(400, "bad_request", "send {kind, subject, textHash}");
  try {
    return NextResponse.json(await spendAsk(k.d, k.key.tenantId, b));
  } catch (err) {
    if (err instanceof AskError) return fail(err.status, err.status === 409 ? "conflict" : err.status === 404 ? "not_found" : "bad_request", err.message);
    return failed(err, "v1.owner-asks.used");
  }
}
