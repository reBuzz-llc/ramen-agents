import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/display-name";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { addSampleRequest } from "@/lib/sample-requests";
import { REQUEST_PICTURES, SampleError } from "@/lib/samples";
import { recordPress } from "@/lib/session-press";

// POST multipart {text, pictures (up to 3 files)}: a person's change request on a sample, its own
// record, with its pictures re-encoded and kept privately. Anyone working the leads, as Request changes was.
const CAP = (REQUEST_PICTURES * 5 + 1) * 1024 * 1024;

/** The body, read up to `max` bytes; null once it is longer (the read stops there). */
async function capped(req: Request, max: number): Promise<Uint8Array<ArrayBuffer> | null> {
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "no such sample" }, { status: 404 });
  if (Number(req.headers.get("content-length") ?? 0) > CAP) return NextResponse.json({ ok: false, error: "the pictures are over 5 MB each" }, { status: 413 });
  // the cap holds while the body is read (a chunked body sends no length), before the form is parsed
  const body = await capped(req, CAP);
  if (!body) return NextResponse.json({ ok: false, error: "the pictures are over 5 MB each" }, { status: 413 });
  let form: FormData;
  try {
    form = await new Response(body, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return NextResponse.json({ ok: false, error: "send the request as a form: text and up to three pictures" }, { status: 400 });
  }
  const files = form.getAll("pictures").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f && (f as File).size > 0);
  // counted before any is read
  if (files.length > REQUEST_PICTURES) return NextResponse.json({ ok: false, error: `a request takes at most ${REQUEST_PICTURES} pictures` }, { status: 400 });
  try {
    const pictures = await Promise.all(files.map(async (f) => new Uint8Array(await f.arrayBuffer())));
    const d = await db();
    const { request } = await addSampleRequest(d, g.who.tenantId, id, { text: String(form.get("text") ?? ""), byName: displayName(g.who.name, g.who.email), byUser: g.who.userId, pictures });
    await recordPress(d, g.who, "sample.request", "sample", id);
    return NextResponse.json({ ok: true, request: { id: request.id, pictures: request.pictures.length } });
  } catch (err) {
    if (err instanceof SampleError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: publicReason(err, "samples.request") }, { status: 500 });
  }
}
