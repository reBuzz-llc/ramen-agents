import { NextResponse } from "next/server";
import { fail, failed, keyed } from "@/lib/board-api";
import { putLeadPhoto, SampleError, SHELL_DAYS } from "@/lib/samples";

// A lead's photos before its first page, with the engine's key (board:write).
//   PUT /v1/samples/by-lead/<leadId>/photos/<name>?guest=1&dish=<dish>   body: the picture's bytes (as /v1/samples/<id>/photos)
//       -> {sampleId, shell, photos}
// The lead's sample takes the photo; when it has none yet, Peek first makes a "shell" (no page, version 0) that holds the
// photos. A shell is shown nowhere a person looks; the lead stays in the Site Builder's queue, and its first page
// (POST /v1/samples/drafts) fills the shell as version 1 with these photos. A shell that gets no page within 7 days is
// removed together with its photos. Refused like a first page: a lead with a website, or one whose sample the owner deleted.
const answer = (err: unknown, where: string) =>
  err instanceof SampleError ? fail(err.status, err.status === 404 ? "not_found" : err.status === 409 ? "conflict" : err.status === 503 ? "unavailable" : "bad_request", err.message) : failed(err, where);

export async function PUT(req: Request, ctx: { params: Promise<{ leadId: string; name: string }> }) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const { leadId, name } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(leadId)) return fail(404, "not_found", `no lead ${leadId}`);
  const q = new URL(req.url).searchParams;
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > 5 * 1024 * 1024 + 1024) return fail(413, "too_large", "the picture is over 5 MB");
  try {
    const bytes = new Uint8Array(await req.arrayBuffer());
    const r = await putLeadPhoto(k.d, k.key.tenantId, leadId, decodeURIComponent(name), bytes, { guest: q.has("guest") ? q.get("guest") === "1" || q.get("guest") === "true" : undefined, dish: q.get("dish") ?? "", by: k.key.name });
    return NextResponse.json({ ...r, ...(r.shell ? { removedAfterDays: SHELL_DAYS } : {}) });
  } catch (err) {
    return answer(err, "v1.samples.by-lead.photos.put");
  }
}
