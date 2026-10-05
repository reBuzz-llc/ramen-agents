import type { NextRequest } from "next/server";
import { findBot } from "@/lib/bots";
import { scoreDetails, type DetailKind } from "@/lib/work-plan";

// The rows behind one scoreboard number: ?bot=<slug>&kind=outputs|refused|flags
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const kind = p.get("kind") as DetailKind;
  if (!["outputs", "refused", "flags"].includes(kind)) return Response.json({ error: "kind must be outputs, refused or flags" }, { status: 400 });
  const bot = await findBot(p.get("bot") ?? "");
  if (!bot) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(await scoreDetails(bot, kind), { headers: { "cache-control": "no-store" } });
}
