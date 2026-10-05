import type { NextRequest } from "next/server";
import { listBots } from "@/lib/bots";
import { keyOverview } from "@/lib/key-overview";

// Every key on this Mac with its usage today and availability (Settings > Key providers > Overview). ?fresh=1 recomputes.
export async function GET(req: NextRequest) {
  try {
    return Response.json(await keyOverview(await listBots(), req.nextUrl.searchParams.get("fresh") === "1"), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
