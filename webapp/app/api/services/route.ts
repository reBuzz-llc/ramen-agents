import type { NextRequest } from "next/server";
import { serviceStatuses } from "@/lib/services";

// The non-model keys (email checkers, search, storage) and whether each works: ?fresh=1 re-checks now.
export async function GET(req: NextRequest) {
  return Response.json(await serviceStatuses(req.nextUrl.searchParams.get("fresh") === "1"), { headers: { "cache-control": "no-store" } });
}
