import { fail, failed, keyed } from "@/lib/board-api";
import { requestPicture } from "@/lib/sample-requests";

// GET /v1/samples/<id>/requests/<rid>/pictures/<n> (board:read): one picture's bytes, re-encoded at
// upload so it carries no metadata. For the site helper; the engine never passes it to a page writer.
export async function GET(req: Request, ctx: { params: Promise<{ id: string; rid: string; n: string }> }) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const { id, rid, n } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", "no such picture");
  try {
    const p = await requestPicture(k.d, k.key.tenantId, id, rid, Number(n));
    if (!p) return fail(404, "not_found", "no such picture");
    return new Response(Buffer.from(p.bytes), { headers: { "content-type": p.type, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (err) {
    return failed(err, "v1.samples.requests.picture");
  }
}
