import type { NextRequest } from "next/server";
import { dataServerUrl, findBot } from "@/lib/bots";

// Read-only proxy to one bot's data server (`bot --config <config> dashboard`).
// Only GET endpoints are exposed, so this app can watch a bot but never steer it.
const ROUTES = new Map<string, string>([
  ["state", "/api/state"],
  ["events", "/api/events"],
  ["notes", "/api/notes"],
  ["questions", "/api/questions"],
  ["interests", "/api/interests"],
  ["journal", "/api/journal"],
  ["screenshot", "/screenshot.png"],
]);

export async function GET(req: NextRequest, ctx: RouteContext<"/api/bots/[slug]/[...path]">) {
  const { slug, path } = await ctx.params;
  const bot = await findBot(slug);
  const target = path.length === 1 ? ROUTES.get(path[0]) : undefined;
  if (!bot || !target) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  const url = dataServerUrl(bot, target);
  const n = req.nextUrl.searchParams.get("n");
  if (path[0] === "events" && n && /^\d{1,3}$/.test(n)) {
    url.searchParams.set("n", n);
  }

  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
    return new Response(res.body, {
      status: res.status,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
        "cache-control": "no-store",
      },
    });
  } catch {
    return Response.json(
      { error: "offline", detail: `Could not reach ${bot.name}'s data server on port ${bot.port}.` },
      { status: 502 },
    );
  }
}
