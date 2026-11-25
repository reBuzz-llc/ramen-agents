import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { answerSend, sendLogOf } from "@/lib/lead-sends";
import { sameOrigin } from "@/lib/same-origin";

// POST {channel?, amount?, link?}: the one extra click after a reply or a win: which channel they answered, the
// amount won, or the held sample link copied. The lead's own status is already saved; this only fills the send log.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { channel?: unknown; amount?: unknown; link?: unknown } | null;
  if (!b || typeof b !== "object") return NextResponse.json({ ok: false, error: "send {channel, amount, link}" }, { status: 400 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "No such lead." }, { status: 404 });
  const d = await db();
  try {
    const r = await answerSend(d, g.who.tenantId, id, b);
    if (!r.ok) return NextResponse.json(r, { status: 400 });
    return NextResponse.json({ ok: true, sendLog: await sendLogOf(d, g.who.tenantId, id) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "leads.send-log") }, { status: 500 });
  }
}
