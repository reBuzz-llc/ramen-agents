import { NextResponse } from "next/server";
import { body, fail, failed, keyed } from "@/lib/board-api";
import { reopenSample, SampleError } from "@/lib/samples";

// POST /v1/samples/reopen {leadId, by?} (board:write): a lead's taken-down or rejected
// sample goes back as sent back for a new page, or one the owner deleted is cleared so a page can be posted for the lead.
export async function POST(req: Request) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  const leadId = typeof b?.leadId === "string" ? b.leadId : typeof b?.lead_id === "string" ? b.lead_id : "";
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return fail(400, "bad_request", "send {leadId}");
  const by = typeof b?.by === "string" && b.by.trim() ? b.by.trim() : k.key.name;
  try {
    return NextResponse.json(await reopenSample(k.d, k.key.tenantId, leadId, by));
  } catch (err) {
    if (err instanceof SampleError) return fail(err.status, err.status === 409 ? "conflict" : err.status === 404 ? "not_found" : "bad_request", err.message);
    return failed(err, "v1.samples.reopen");
  }
}
