import { shoulder } from "@/lib/board";
import { findBot } from "@/lib/bots";
import { workspaceDir } from "@/lib/control";
import { dbPath } from "@/lib/episodes";
import type { NextRequest } from "next/server";

// Over the shoulder: what one bot sees now and its last 20 actions, for the world's large view.
// Read-only: its fresh screenshot (served by ./shot), the page in its newest trace, its actions table.
export async function GET(req: NextRequest) {
  const bot = await findBot(req.nextUrl.searchParams.get("bot") ?? "");
  if (!bot) return Response.json({ error: "not found" }, { status: 404 });
  try {
    const data = await shoulder(await workspaceDir(bot), await dbPath(bot).catch(() => null), Date.now());
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: `could not read ${bot.name}: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
