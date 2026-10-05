import { findBot } from "@/lib/bots";
import { ChatOffline, MAX_MESSAGE_CHARS, readChat, sendChat } from "@/lib/chat";
import { sameOrigin } from "@/lib/same-origin";

const NO_STORE = { "cache-control": "no-store" };

// The conversation so far, oldest first. Includes messages the bot sent on its own (its `say` action).
export async function GET(_req: Request, ctx: RouteContext<"/api/bots/[slug]/chat">) {
  const bot = await findBot((await ctx.params).slug);
  if (!bot) return Response.json({ error: "not found" }, { status: 404 });
  try {
    return Response.json(await readChat(bot), { headers: NO_STORE });
  } catch (err) {
    const offline = err instanceof ChatOffline;
    return Response.json({ error: offline ? "offline" : "failed", detail: err instanceof Error ? err.message : String(err) }, { status: offline ? 502 : 500, headers: NO_STORE });
  }
}

// Send a message (or a /command). Only this app's own page may post, like the other write endpoints.
export async function POST(req: Request, ctx: RouteContext<"/api/bots/[slug]/chat">) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  const bot = await findBot((await ctx.params).slug);
  if (!bot) return Response.json({ error: "not found" }, { status: 404 });

  const raw = await req.text();
  if (raw.length > MAX_MESSAGE_CHARS * 2 + 256) return Response.json({ error: "message too long" }, { status: 413 });
  let text: unknown;
  try {
    text = (JSON.parse(raw) as Record<string, unknown>).text;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  if (typeof text !== "string" || !text.trim()) return Response.json({ error: "write a message first" }, { status: 400 });
  if (text.length > MAX_MESSAGE_CHARS) return Response.json({ error: `keep a message under ${MAX_MESSAGE_CHARS} characters` }, { status: 413 });

  try {
    const { status, body } = await sendChat(bot, text.trim());
    return Response.json(body, { status, headers: NO_STORE });
  } catch (err) {
    const offline = err instanceof ChatOffline;
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: offline ? 502 : 500, headers: NO_STORE });
  }
}
