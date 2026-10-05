import { fetchState, findBot } from "@/lib/bots";
import { inspectBot } from "@/lib/machine";

// What one bot is running on this Mac right now: its browser, helper processes, and the local
// services it depends on. Read by this app from the process table, not by the bot's data server,
// so it still answers when the bot or its data server is down.
export async function GET(_req: Request, ctx: RouteContext<"/api/bots/[slug]/machine">) {
  const { slug } = await ctx.params;
  const bot = await findBot(slug);
  if (!bot) return Response.json({ error: "not found" }, { status: 404 });

  // The heartbeat says whether quiet mode closed the browser on purpose. Best effort.
  const heartbeatStatus = (await fetchState(bot, 1500))?.heartbeat?.status ?? null;

  return Response.json(await inspectBot(bot, heartbeatStatus), { headers: { "cache-control": "no-store" } });
}
