import type { NextRequest } from "next/server";
import { findBot } from "@/lib/bots";
import { RANGES, summary, type RangeKey } from "@/lib/summary";

// What a bot did over ?range=24h|7d|30d|90d, from its own database (read-only).
export async function GET(req: NextRequest, ctx: RouteContext<"/api/bots/[slug]/summary">) {
  const bot = await findBot((await ctx.params).slug);
  if (!bot) return Response.json({ error: "not found" }, { status: 404 });
  const range = (req.nextUrl.searchParams.get("range") ?? "24h") as RangeKey;
  if (!(range in RANGES)) return Response.json({ error: "range must be 24h, 7d, 30d or 90d" }, { status: 400 });
  try {
    return Response.json(await summary(bot, range), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: `could not read the summary: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` }, { status: 500 });
  }
}
