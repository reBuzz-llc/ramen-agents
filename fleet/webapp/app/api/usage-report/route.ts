import { jsonResponse } from "@/lib/json-response";
import type { NextRequest } from "next/server";
import { PERIODS, recordUsage, reportFor, type Period } from "@/lib/usage-history";

// Settings > Key providers > Reports: model calls, tokens, searches and email checks for this month, the last 3 months,
// this quarter or this year (?period=month|3months|quarter|year). Records today's counters first, so today is current.
export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams.get("period");
    const period: Period = PERIODS.some((x) => x.key === p) ? (p as Period) : "month";
    await recordUsage().catch(() => null);
    return jsonResponse(req, await reportFor(period));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
