import { readFile } from "node:fs/promises";
import { freshShot } from "@/lib/board";
import { findBot } from "@/lib/bots";
import { workspaceDir } from "@/lib/control";
import type { NextRequest } from "next/server";

// The bot's current screenshot, only while it is under 10 minutes old (404 otherwise: the view then shows the page text).
export async function GET(req: NextRequest) {
  const bot = await findBot(req.nextUrl.searchParams.get("bot") ?? "");
  if (!bot) return new Response("not found", { status: 404 });
  const shot = await freshShot(await workspaceDir(bot), Date.now());
  if (!shot) return new Response("no fresh screenshot", { status: 404 });
  const png = await readFile(/*turbopackIgnore: true*/ shot.file).catch(() => null);
  if (!png) return new Response("gone", { status: 404 });
  return new Response(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
}
