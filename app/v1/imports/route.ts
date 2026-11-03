import { NextResponse } from "next/server";
import { keyed } from "@/lib/board-api";
import { recentImports } from "@/lib/lead-import";

// GET: the recent lead imports (who, when, the file, the counts, and the ids of the leads each created), so the
// Validator can list the new rows for the Enricher.
export async function GET(req: Request) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  return NextResponse.json({ imports: await recentImports(k.d, k.key.tenantId) });
}
