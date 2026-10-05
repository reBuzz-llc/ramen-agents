import type { NextRequest } from "next/server";
import { readRequests } from "@/lib/requests";

const NO_STORE = { "cache-control": "no-store" };

// Bot-to-bot requests, newest sent first. Read-only: the bots write via fleet_requests.py, this shows it.
// ?count=1 returns only the count of open (unanswered, unresolved) priority requests, for a nav badge.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("limit");
  const asked = raw === null ? NaN : Number(raw);
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(2000, Math.trunc(asked)) : 500;
  const requests = await readRequests(limit);
  if (req.nextUrl.searchParams.get("count")) {
    const open = requests.filter((r) => r.priority && !r.answeredAt && !r.resolvedAt).length;
    return Response.json({ open }, { headers: NO_STORE });
  }
  return Response.json(requests, { headers: NO_STORE });
}
