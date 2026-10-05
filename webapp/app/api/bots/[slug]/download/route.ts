import { createReadStream, statSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { BOTS_DIR, findBot } from "@/lib/bots";

// The installable Mac app for the desk-agent bot. The path is built from constants only, never from
// the request. Only desk-agent has one; every other slug is a 404. proxy.ts already gates this route
// to this Mac and the owner's Tailscale login.
// Renamed rebuzzBot -> Desk Agent (owner, 2026-09-25): the new image first, the old one until it is built.
const DOWNLOADS = path.join(BOTS_DIR, "common-data", "downloads");
const DMG_NAMES = ["Desk Agent.dmg", "rebuzzBot.dmg"];

export async function GET(_req: Request, ctx: RouteContext<"/api/bots/[slug]/download">) {
  const { slug } = await ctx.params;
  if (slug !== "desk-agent" || !(await findBot(slug))) {
    return Response.json({ error: "not found" }, { status: 404 });
  }
  let size = 0;
  let name = "";
  for (const n of DMG_NAMES) {
    try {
      size = statSync(/*turbopackIgnore: true*/ path.join(DOWNLOADS, n)).size;
      name = n;
      break;
    } catch {
      /* not built under this name */
    }
  }
  if (!name) return Response.json({ error: "the app has not been built yet" }, { status: 404 });
  const stream = Readable.toWeb(createReadStream(/*turbopackIgnore: true*/ path.join(DOWNLOADS, name))) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    headers: {
      "content-type": "application/x-apple-diskimage",
      "content-length": String(size),
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "no-store",
    },
  });
}
