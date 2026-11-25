import { NextResponse } from "next/server";
import { body, fail, failed, keyed } from "@/lib/board-api";
import { listProposals, openProposal, ProposalError } from "@/lib/template-proposals";

// The template proposals, for the Validator's key. GET ?status=<open|approved|declined|one_off|replaced>
// &since=<iso>: newest first. POST {lead_id, edit_id}: opens one for an edit nobody answered on Peek (built from the save
// itself); 409 when the edit has one, or its text was declined or kept one-off before.
export async function GET(req: Request) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const p = new URL(req.url).searchParams;
  const since = p.get("since") ? new Date(p.get("since")!) : undefined;
  if (since && isNaN(+since)) return fail(400, "bad_request", "since is an ISO time");
  try {
    return NextResponse.json({ proposals: await listProposals(k.d, k.key.tenantId, { status: p.get("status") || undefined, since }) });
  } catch (err) {
    return failed(err, "v1.template-proposals");
  }
}

export async function POST(req: Request) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  const leadId = typeof b?.lead_id === "string" ? b.lead_id : "";
  const editId = Number(b?.edit_id);
  if (!leadId || !Number.isInteger(editId)) return fail(400, "bad_request", "send {lead_id, edit_id}");
  try {
    return NextResponse.json({ proposal: await openProposal(k.d, k.key.tenantId, leadId, editId) }, { status: 201 });
  } catch (err) {
    if (err instanceof ProposalError) return fail(err.status, err.status === 409 ? "conflict" : err.status === 404 ? "not_found" : "bad_request", err.message, err.current ? { proposal: err.current } : {});
    return failed(err, "v1.template-proposals");
  }
}
