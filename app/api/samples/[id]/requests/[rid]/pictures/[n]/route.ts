import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/guard";
import { requestPicture } from "@/lib/sample-requests";

// GET: one picture of a change request, for the Samples page's card. Signed in only; never cached
// outside the browser, never framed, never sniffed as anything but the picture it is.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; rid: string; n: string }> }) {
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const { id, rid, n } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "no such picture" }, { status: 404 });
  const p = await requestPicture(await db(), g.who.tenantId, id, rid, Number(n));
  if (!p) return NextResponse.json({ error: "no such picture" }, { status: 404 });
  return new Response(Buffer.from(p.bytes), { headers: { "content-type": p.type, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox" } });
}
