import type { NextRequest } from "next/server";
import { readRoom } from "@/lib/chatroom";

const NO_STORE = { "cache-control": "no-store" };

// The shared fleet chatroom, oldest first (the page sorts). Read-only: the bots post to it, this shows it.
export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("limit");
  const asked = raw === null ? NaN : Number(raw);
  const limit = Number.isFinite(asked) && asked > 0 ? Math.min(2000, Math.trunc(asked)) : 500;
  return Response.json(await readRoom(limit), { headers: NO_STORE });
}
