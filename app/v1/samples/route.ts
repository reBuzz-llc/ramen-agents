import { NextResponse } from "next/server";
import { failed, keyed } from "@/lib/board-api";
import { SAMPLE_LIST_LIMIT, listSamples, openRequestCounts } from "@/lib/samples";

// The answer stops at the limit; the log says so, at most once an hour, so we hear of it before a caller misses a row
const HOUR = 3_600_000;
let saidAt = 0;

// GET /v1/samples?status=draft,changes_requested&lead_id= (board:read): the samples without their
// page, newest first -- the Site Builder's notes to act on, the Validator's SB checks. A changes_requested row's `note` is
// the person's request.
export async function GET(req: Request) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const p = new URL(req.url).searchParams;
  const status = (p.get("status") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  try {
    const list = await listSamples(k.d, k.key.tenantId, { status, leadId: p.get("lead_id") ?? undefined });
    if (list.length >= SAMPLE_LIST_LIMIT && Date.now() - saidAt >= HOUR) {
      saidAt = Date.now();
      console.warn(`[v1.samples] the list reached its limit of ${SAMPLE_LIST_LIMIT}: older samples are not in this answer`);
    }
    // each sample's open change requests, and how many carry a picture
    const counts = await openRequestCounts(k.d, k.key.tenantId, list.map((x) => x.id));
    return NextResponse.json({ samples: list.map((x) => ({ ...x, openRequests: counts.get(x.id)?.open ?? 0, openWithPictures: counts.get(x.id)?.withPictures ?? 0 })) });
  } catch (err) {
    return failed(err, "v1.samples");
  }
}
