import type { NextRequest } from "next/server";
import { readAllowance } from "@/lib/allowance";
import { BOTS_DIR } from "@/lib/bots";
import { jsonResponse } from "@/lib/json-response";

// The free allowance, provider by provider: the chain's use today and what is left, and the keyed
// providers that are not in the chain with their last use. Names only, never a key.
export async function GET(req: NextRequest) {
  try {
    return jsonResponse(req, await readAllowance(BOTS_DIR));
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
