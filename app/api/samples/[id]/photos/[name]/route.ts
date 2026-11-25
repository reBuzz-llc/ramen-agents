import { db } from "@/lib/db";
import { guard } from "@/lib/guard";
import { PHOTO_NAME } from "@/lib/sample-photos";
import { samplePhotoBytes } from "@/lib/samples";
import { pressedInSession, pressSession, recordPress } from "@/lib/session-press";

// GET: one of the sample's uploaded photos, for the review card. Anyone on the team (samples.review); only a name on
// this sample's own list is served, as the type its bytes really are, never as a page.
export async function GET(req: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  const g = await guard("samples.review");
  if ("res" in g) return g.res;
  const { id, name } = await ctx.params;
  const file = decodeURIComponent(name);
  if (!/^[0-9a-f-]{36}$/i.test(id) || !PHOTO_NAME.test(file)) return new Response("no such photo", { status: 404 });
  const d = await db();
  const p = await samplePhotoBytes(d, g.who.tenantId, id, file).catch(() => null);
  if (!p) return new Response("no such photo", { status: 404 });
  // the full-size view is never answered from a cache, and is what lets this person Accept this photo
  const full = new URL(req.url).searchParams.get("view") === "full";
  if (full && p.viewKey) {
    const session = await pressSession(d).catch(() => null);
    if (session && !(await pressedInSession(d, g.who, "sample.photo_full", p.viewKey, session).catch(() => false))) await recordPress(d, g.who, "sample.photo_full", "sample_photo", p.viewKey);
  }
  return new Response(Buffer.from(p.bytes), {
    headers: { "content-type": p.type, "cache-control": full ? "no-store" : "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "x-robots-tag": "noindex, nofollow" },
  });
}
