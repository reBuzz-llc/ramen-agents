import { NextResponse } from "next/server";
import { body, fail, failed, keyed } from "@/lib/board-api";
import { ownerNote, SampleError } from "@/lib/samples";

// POST /v1/samples/{id}/note {note, by?} (board:write): the owner's answer from the dashboard's
// Decisions box, "what should it work on next", as the sample's Request-changes note (lib/samples.ts ownerNote). The Site
// Builder's queue then lists the sample as "changes" with it. It arrives with a key, so `by` is only a label and the
// request is never byPerson, even when it says it is the owner's.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", `no sample ${id}`);
  const by = typeof b?.by === "string" && b.by.trim() ? b.by.trim() : k.key.name;
  try {
    return NextResponse.json({ sample: await ownerNote(k.d, k.key.tenantId, id, typeof b?.note === "string" ? b.note : "", by) });
  } catch (err) {
    if (err instanceof SampleError) return fail(err.status, err.status === 409 ? "conflict" : err.status === 404 ? "not_found" : "bad_request", err.message);
    return failed(err, "v1.samples.note");
  }
}
