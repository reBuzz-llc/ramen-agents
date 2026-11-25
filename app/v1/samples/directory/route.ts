import { NextResponse } from "next/server";
import { failed, keyed } from "@/lib/board-api";
import { directory } from "@/lib/sample-directory";

// GET: the public directory's cards: live samples with the facts lib/sample-directory.ts allows.
// ?since=<ISO time>: every sample changed after it, live or not, so a take-down reaches the blog. Read with a board:read
// key (the fleet's dashboard key).
export async function GET(req: Request) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const raw = new URL(req.url).searchParams.get("since");
  const since = raw && !Number.isNaN(Date.parse(raw)) ? new Date(raw) : null;
  try {
    return NextResponse.json({ samples: await directory(k.d, k.key.tenantId, since), at: new Date().toISOString() });
  } catch (err) {
    return failed(err, "v1.samples.directory");
  }
}
