import { NextResponse } from "next/server";
import { fail, failed, keyed } from "@/lib/board-api";
import { reopenRequest, SampleError } from "@/lib/samples";

// POST /v1/samples/<id>/requests/<rid> {action: "reopen"} (board:write): a key may send back a request a round claimed. It can
// never confirm one, since Peek cannot tell the site helper's key from the engine's, and never on a sample with an approved version (lib/samples.ts).
export async function POST(req: Request, ctx: { params: Promise<{ id: string; rid: string }> }) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const { id, rid } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(rid)) return fail(404, "not_found", "no such request");
  const b = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (b?.action !== "reopen") return fail(400, "bad_request", "action is reopen");
  try {
    return NextResponse.json(await reopenRequest(k.d, k.key.tenantId, id, rid, null));
  } catch (err) {
    if (err instanceof SampleError) return fail(err.status, err.status === 404 ? "not_found" : err.status === 403 ? "forbidden" : "conflict", err.message);
    return failed(err, "v1.samples.requests.reopen");
  }
}
