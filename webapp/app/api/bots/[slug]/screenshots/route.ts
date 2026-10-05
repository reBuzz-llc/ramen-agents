import { findBot } from "@/lib/bots";
import { listScreenshots } from "@/lib/screenshots";

// The saved screenshots of one bot, newest first.
export async function GET(_req: Request, ctx: RouteContext<"/api/bots/[slug]/screenshots">) {
  const bot = await findBot((await ctx.params).slug);
  if (!bot) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(await listScreenshots(bot), { headers: { "cache-control": "no-store" } });
}
