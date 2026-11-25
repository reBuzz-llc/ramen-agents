import { NextResponse } from "next/server";
import { fail, failed, keyed } from "@/lib/board-api";
import { PHOTO_NAME } from "@/lib/sample-photos";
import { deleteSamplePhoto, putSamplePhoto, samplePhotoBytes, SampleError } from "@/lib/samples";

// A sample's edited photos, uploaded by the helper with the engine's key (board:write).
//   GET    /v1/samples/<id>/photos/<name>                         -> the picture's bytes (for the review before a person
//          approves; the keys that can upload it, only a name on this sample's own list, this key's company only)
//   PUT    /v1/samples/<id>/photos/<name>?guest=1&dish=<dish>   body: the picture's bytes (webp, jpeg or png; at most 5 MB;
//          90 files and 30 MB a sample; the same name again replaces it) -> {photos}
//   DELETE /v1/samples/<id>/photos/<name>                         -> {photos} (refused while the current page uses it)
// A page then points at photos/<name> (../photos/<name> on an extra page); lib/sample-photos.ts.
const answer = (err: unknown, where: string) =>
  err instanceof SampleError ? fail(err.status, err.status === 404 ? "not_found" : err.status === 409 ? "conflict" : err.status === 503 ? "unavailable" : "bad_request", err.message) : failed(err, where);

export async function GET(req: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const { id, name } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !PHOTO_NAME.test(name)) return fail(404, "not_found", "no such photo");
  try {
    const p = await samplePhotoBytes(k.d, k.key.tenantId, id, name);
    if (!p) return fail(404, "not_found", "no such photo");
    return new Response(Buffer.from(p.bytes), {
      headers: { "content-type": p.type, "cache-control": "no-store", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "x-robots-tag": "noindex, nofollow" },
    });
  } catch (err) {
    return failed(err, "v1.samples.photos.get");
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const { id, name } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", `no sample ${id}`);
  const q = new URL(req.url).searchParams;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 5 * 1024 * 1024 + 1024) return fail(413, "too_large", "the picture is over 5 MB");
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    const photos = await putSamplePhoto(k.d, k.key.tenantId, id, decodeURIComponent(name), bytes, { guest: q.has("guest") ? q.get("guest") === "1" || q.get("guest") === "true" : undefined, dish: q.get("dish") ?? "", by: k.key.name });
    return NextResponse.json({ photos });
  } catch (err) {
    return answer(err, "v1.samples.photos.put");
  }
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const { id, name } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", `no sample ${id}`);
  try {
    return NextResponse.json({ photos: await deleteSamplePhoto(k.d, k.key.tenantId, id, decodeURIComponent(name)) });
  } catch (err) {
    return answer(err, "v1.samples.photos.delete");
  }
}
