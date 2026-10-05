import type { NextRequest } from "next/server";
import { findBot } from "@/lib/bots";
import { MAX_EPISODES, readEpisodes } from "@/lib/episodes";

// Whole episodes from the bot's database: ?id=50 for one, or ?limit=10 (default) for the latest, newest first.
export async function GET(req: NextRequest, ctx: RouteContext<"/api/bots/[slug]/episodes">) {
  const bot = await findBot((await ctx.params).slug);
  if (!bot) return Response.json({ error: "not found" }, { status: 404 });
  const id = req.nextUrl.searchParams.get("id");
  const limit = req.nextUrl.searchParams.get("limit");
  if ((id !== null && !/^\d{1,9}$/.test(id)) || (limit !== null && !/^\d{1,3}$/.test(limit))) {
    return Response.json({ error: `id must be a number; limit 1 to ${MAX_EPISODES}` }, { status: 400 });
  }
  try {
    const episodes = await readEpisodes(bot, id !== null ? { id: Number(id) } : { limit: limit !== null ? Number(limit) : 10 });
    return Response.json(episodes, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: `could not read episodes: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` }, { status: 500 });
  }
}
