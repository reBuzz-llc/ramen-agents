import type { NextRequest } from "next/server";
import { findBot } from "@/lib/bots";
import { providerCatalog } from "@/lib/keys";

// One bot's model chain and the other providers the bot code knows, with key presence only (never keys).
export async function GET(req: NextRequest) {
  const bot = await findBot(req.nextUrl.searchParams.get("bot") ?? "");
  if (!bot) return Response.json({ error: "not found" }, { status: 404 });
  try {
    return Response.json(await providerCatalog(bot), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: `could not read providers: ${err instanceof Error ? err.message.split("\n")[0] : String(err)}` }, { status: 500 });
  }
}
