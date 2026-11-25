import { NextResponse } from "next/server";
import { fail, failed, keyed } from "@/lib/board-api";
import { listSamples, sampleDoc, sampleVersionsOf } from "@/lib/samples";

// GET /v1/samples/{id}?v=<n> (board:read; the Validator's SB07/SB08 sweep): one sample with its stored page -- the
// current version, or ?v=<n> a kept one -- and the list of its versions. The list endpoint stays without html (it is heavy).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail(404, "not_found", `no sample ${id}`);
  const v = Number(new URL(req.url).searchParams.get("v"));
  const version = Number.isInteger(v) && v > 0 ? v : undefined;
  try {
    const [sample] = await listSamples(k.d, k.key.tenantId, { id });
    if (!sample) return fail(404, "not_found", `no sample ${id}`);
    const doc = await sampleDoc(k.d, k.key.tenantId, id, version);
    if (!doc) return fail(404, "not_found", `no version ${version} of sample ${id}`);
    return NextResponse.json({ sample, version: version ?? sample.version, kind: doc.kind, html: doc.html, versions: await sampleVersionsOf(k.d, k.key.tenantId, id) });
  } catch (err) {
    return failed(err, "v1.samples.one");
  }
}
