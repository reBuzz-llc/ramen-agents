import { NextResponse } from "next/server";
import { body, botActor, fail, failed, keyed } from "@/lib/board-api";
import { batchWrite, type BatchWrite } from "@/lib/leads";

// POST {actor, writes: [{id | notion_page_id, fields, create?, fill_only?, source_url?}]}: up to 100 writes, each on its
// own; answers {results} in the same order, each like a single write's answer.
export async function POST(req: Request, ctx: { params: Promise<{ board: string }> }) {
  if ((await ctx.params).board !== "leads") return fail(404, "not_found", "the boards here are: leads");
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b) return fail(400, "bad_request", "send {actor, writes}");
  try {
    const r = await batchWrite(k.d, k.key.tenantId, b.writes as BatchWrite[], botActor(k.key, b.actor));
    if (!r.ok) return fail(r.code === "too_large" ? 413 : 400, r.code, r.message);
    return NextResponse.json({
      results: r.results.map((x) => (x.ok ? { ok: true, id: x.lead.id, rev: x.lead.rev, created: x.created, written: x.written, refused: x.refused } : { ok: false, error: { code: x.code, message: x.message, ...(x.existingId ? { existing_id: x.existingId } : {}) } })),
    });
  } catch (err) {
    return failed(err, "v1.batch");
  }
}
