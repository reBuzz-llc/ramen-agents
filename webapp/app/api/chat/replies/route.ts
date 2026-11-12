import { liveBoard } from "@/lib/board-read";
import { listBots } from "@/lib/bots";

// Each agent's last reply time in the owner's chat with it, and its name (queue 35), for the Notifications page's
// "<name> answered you at HH:MM"; from the board's 5 s cache.
export async function GET() {
  const [board, bots] = await Promise.all([liveBoard(), listBots()]);
  const names = Object.fromEntries(bots.map((b) => [b.slug, b.name]));
  return Response.json({ replies: board.replies, names }, { headers: { "cache-control": "no-store" } });
}
