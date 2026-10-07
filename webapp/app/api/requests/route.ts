import { jsonResponse } from "@/lib/json-response";
import type { NextRequest } from "next/server";
import { readRequests, type FleetRequest } from "@/lib/requests";

const NO_STORE = { "cache-control": "no-store" };

const latest = (r: FleetRequest) => [r.sentAt, r.answeredAt ?? "", r.resolvedAt ?? ""].reduce((a, b) => (b > a ? b : a));
const isOpen = (r: FleetRequest) => !r.answeredAt && !r.resolvedAt && !r.expired;

// Bot-to-bot requests, newest sent first. Read-only: the bots write via fleet_requests.py, this shows it.
//   ?days=N   (default 3) every open request plus those with activity in the last N days, as {items, total, days};
//             the page polls every 5 s and the whole history had grown to 270 KB (2026-10-05). ?days=0 = everything.
//   ?count=1  only the count of open priority requests, for the profile menu badge.
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const requests = await readRequests(5000);
  if (p.get("count")) {
    return Response.json({ open: requests.filter((r) => r.priority && isOpen(r)).length }, { headers: NO_STORE });
  }
  const daysRaw = Number(p.get("days") ?? 3);
  const days = Number.isFinite(daysRaw) && daysRaw >= 0 ? Math.min(365, Math.trunc(daysRaw)) : 3;
  let items = requests;
  if (days > 0) {
    const d = new Date(Date.now() - days * 86400e3);
    const since = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
    items = requests.filter((r) => isOpen(r) || latest(r) >= since);
  }
  return jsonResponse(req, { items, total: requests.length, open: requests.filter(isOpen).length, days });
}
