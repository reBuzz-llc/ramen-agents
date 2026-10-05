import { findBot } from "@/lib/bots";
import { readScreenshot } from "@/lib/screenshots";

// One saved screenshot. Its id carries its time and content hash, so it never changes.
export async function GET(_req: Request, ctx: RouteContext<"/api/bots/[slug]/screenshots/[id]">) {
  const { slug, id } = await ctx.params;
  const bot = await findBot(slug);
  const png = bot ? await readScreenshot(bot, id) : null;
  if (!png) return Response.json({ error: "not found" }, { status: 404 });
  return new Response(new Uint8Array(png), {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=31536000, immutable" },
  });
}
