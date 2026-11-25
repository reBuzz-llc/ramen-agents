import { NextResponse } from "next/server";
import { body, fail, failed, keyed } from "@/lib/board-api";
import { patchProposal, ProposalError } from "@/lib/template-proposals";

// PATCH /v1/template-proposals/<id> (the Validator's key): {failed_rules?, checked?, count?} its
// checks and the refreshed count; {status, decided_by?, decided_where?} the owner's answer from the Decisions box. A status
// is set only while the proposal is open (the first answer wins): else 409 with the current record. With the
// Validator's key only (scope board:validate), {template, placeholders?, by?} uplifts an open proposal's text; the
// earlier text is kept in template_history (403 for any other key).
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b) return fail(400, "bad_request", "send a JSON object");
  try {
    return NextResponse.json({ proposal: await patchProposal(k.d, k.key.tenantId, (await ctx.params).id, b, { key: k.key.name, validator: k.key.scopes.includes("board:validate") }) });
  } catch (err) {
    if (err instanceof ProposalError) return fail(err.status, err.status === 409 ? "conflict" : err.status === 404 ? "not_found" : err.status === 403 ? "forbidden" : "bad_request", err.message, err.current ? { proposal: err.current } : {});
    return failed(err, "v1.template-proposals.patch");
  }
}
