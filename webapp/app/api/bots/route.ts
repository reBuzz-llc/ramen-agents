import { listBots, summarize } from "@/lib/bots";

// Every bot on this Mac with a live status line, for the profile switcher.
export async function GET() {
  const bots = await listBots();
  return Response.json(await Promise.all(bots.map(summarize)), { headers: { "cache-control": "no-store" } });
}
