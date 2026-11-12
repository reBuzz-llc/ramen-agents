import { readFile } from "node:fs/promises";
import path from "node:path";
import { isShotName } from "@/lib/web-shots";
import { SHOTS_DIR } from "@/lib/web-read";

// One picture from the floating screens' ring (queue 39): a ring file name only, never a path.
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params;
  if (!isShotName(file) || path.basename(file) !== file) return new Response("not found", { status: 404 });
  try {
    const body = await readFile(/*turbopackIgnore: true*/ path.join(SHOTS_DIR, file));
    return new Response(new Uint8Array(body), { headers: { "content-type": "image/png", "cache-control": "no-store" } });
  } catch {
    return new Response("not found", { status: 404 });
  }
}
