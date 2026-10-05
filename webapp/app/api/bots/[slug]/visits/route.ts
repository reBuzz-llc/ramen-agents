import type { NextRequest } from "next/server";
import { findBot } from "@/lib/bots";
import { readVisits } from "@/lib/visits";

// The pages this bot opened: ?offset= &domain= &q= &failed=1
export async function GET(req: NextRequest, ctx: RouteContext<"/api/bots/[slug]/visits">) {
  const bot = await findBot((await ctx.params).slug);
  if (!bot) return Response.json({ error: "not found" }, { status: 404 });
  const p = req.nextUrl.searchParams;
  try {
    const page = await readVisits(bot, {
      offset: Number(p.get("offset")) || 0,
      domain: p.get("domain") ?? undefined,
      q: p.get("q") ?? undefined,
      failed: p.get("failed") === "1",
    });
    return Response.json(page, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: `could not read the pages: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` }, { status: 500 });
  }
}
