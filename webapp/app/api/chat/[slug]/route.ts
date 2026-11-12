import { stat } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR, listBots } from "@/lib/bots";
import { workspaceDir } from "@/lib/control";
import { cleanText, MAX_CHAT, postChat, readChat } from "@/lib/owner-chat";
import { sameOrigin } from "@/lib/same-origin";
import { hasChat } from "@/lib/world";

// The owner's private chat with one agent (queue 34): GET ?limit=100 its lines oldest first; POST {text} the owner's
// line (to the chat file and the bot's inbox). Only this app's own page may post.
type Ctx = { params: Promise<{ slug: string }> };
const chatFile = (slug: string) => path.join(BOTS_DIR, "common-data", "shared-state", "owner-chat", `${slug}.jsonl`);

async function botOf(ctx: Ctx) {
  const { slug } = await ctx.params;
  // the Validator has no chat: it never answers one
  return hasChat(slug) ? ((await listBots()).find((b) => b.slug === slug) ?? null) : null;
}

export async function GET(req: Request, ctx: Ctx) {
  const bot = await botOf(ctx);
  if (!bot) return Response.json({ error: "no such bot" }, { status: 404 });
  const limit = Math.min(500, Math.max(1, Number(new URL(req.url).searchParams.get("limit")) || 100));
  const asleep = await stat(/*turbopackIgnore: true*/ path.join(await workspaceDir(bot), "STOP")).then(() => true, () => false);
  return Response.json({ name: bot.name, asleep, lines: await readChat(chatFile(bot.slug), limit) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request, ctx: Ctx) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  const bot = await botOf(ctx);
  if (!bot) return Response.json({ error: "no such bot" }, { status: 404 });
  let body: { text?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  const text = cleanText(body.text);
  if (!text) return Response.json({ error: `write something, ${MAX_CHAT} characters at most` }, { status: 400 });
  try {
    const { line } = await postChat({ chatFile: chatFile(bot.slug), ws: await workspaceDir(bot), text });
    return Response.json({ line });
  } catch (err) {
    return Response.json({ error: `could not deliver: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
