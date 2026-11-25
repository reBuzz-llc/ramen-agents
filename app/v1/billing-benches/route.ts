import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { body, fail, failed, keyed, metered } from "@/lib/board-api";
import { addBench, AskError, listBenches } from "@/lib/owner-asks";

// POST {host, itemId, why, at?} (board:write) adds a bench: the same host and item twice
// keeps the first, and no key can clear or change one. GET (board:read): {benches: [{host, itemId, why, at, cleared, clearedAt,
// byOwner, person}]}, with an ETag. A reader lifts a bench only on cleared AND byOwner, and treats a failed read as still benched.
const shape = ({ id: _id, ...b }: Awaited<ReturnType<typeof listBenches>>[number]) => (void _id, b);

export async function POST(req: Request) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b) return fail(400, "bad_request", "send {host, itemId, why, at?}");
  try {
    return NextResponse.json({ bench: shape(await addBench(k.d, k.key.tenantId, b, k.key.name)) });
  } catch (err) {
    if (err instanceof AskError) return fail(err.status, "bad_request", err.message);
    return failed(err, "v1.billing-benches");
  }
}

export async function GET(req: Request) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  try {
    const payload = { benches: (await listBenches(k.d, k.key.tenantId)).map(shape) };
    const etag = `W/"benches-${createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24)}"`;
    if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers: { etag, "cache-control": "no-cache" } });
    return await metered(k.d, k.key, payload, { etag, "cache-control": "no-cache" });
  } catch (err) {
    return failed(err, "v1.billing-benches.read");
  }
}
