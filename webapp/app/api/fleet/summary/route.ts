import type { NextRequest } from "next/server";
import { fleetSummary } from "@/lib/fleet";
import { RANGES, type RangeKey } from "@/lib/summary";

// Every bot over ?range=24h|7d|30d|90d, and how work moved between them (read-only).
export async function GET(req: NextRequest) {
  const range = (req.nextUrl.searchParams.get("range") ?? "24h") as RangeKey;
  if (!(range in RANGES)) return Response.json({ error: "range must be 24h, 7d, 30d or 90d" }, { status: 400 });
  try {
    return Response.json(await fleetSummary(range), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: `could not read the fleet: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` }, { status: 500 });
  }
}
