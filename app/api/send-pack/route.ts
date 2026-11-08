import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { fillPack, markPackSent } from "@/lib/send-pack";
import { sameOrigin } from "@/lib/same-origin";
import { displayName } from "@/lib/display-name";

// The send pack on the Clock home. POST {action: "fill"}: take leads from Send next until the
// person holds ten. POST {action: "sent", id}: mark one of their pack's leads sent as them, then top the pack up.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown } | null;
  try {
    const d = await db();
    if (b?.action === "fill") return NextResponse.json({ ok: true, added: await fillPack(d, g.who.tenantId, g.who.userId) });
    if (b?.action === "sent" && typeof b.id === "string" && /^[0-9a-f-]{36}$/i.test(b.id)) {
      const r = await markPackSent(d, g.who.tenantId, b.id, { userId: g.who.userId, name: displayName(g.who.name, g.who.email) });
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    return NextResponse.json({ ok: false, error: 'send {action: "fill"} or {action: "sent", id}' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "send-pack") }, { status: 500 });
  }
}
