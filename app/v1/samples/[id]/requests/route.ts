import { NextResponse } from "next/server";
import { fail, failed, keyed } from "@/lib/board-api";
import { requestView } from "@/lib/sample-requests";
import { listSamples, requestsOf } from "@/lib/samples";

// GET /v1/samples/<id>/requests[?status=open] (board:read): a sample's
// change requests, newest first (at most 50) -- {sampleId, leadId, approvedVersion, version, requests: [{id, text, by, byPerson, at,
// madeOnVersion, status, answeredVersion, answeredAt, pictures: [{n, type, bytes}], needsHelper}]}. A request with a
// picture needs the site helper; the page writer gets the words only.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", `no sample ${id}`);
  const status = new URL(req.url).searchParams.get("status") ?? "";
  if (status && !["open", "addressed", "answered", "withdrawn"].includes(status)) return fail(400, "bad_request", "status is open, addressed, answered or withdrawn");
  try {
    const [s] = await listSamples(k.d, k.key.tenantId, { id });
    if (!s) return fail(404, "not_found", `no sample ${id}`);
    const list = await requestsOf(k.d, k.key.tenantId, id, status || undefined);
    return NextResponse.json({ sampleId: s.id, leadId: s.leadId, approvedVersion: s.approvedVersion, version: s.version, requests: list.map(requestView) });
  } catch (err) {
    return failed(err, "v1.samples.requests");
  }
}
