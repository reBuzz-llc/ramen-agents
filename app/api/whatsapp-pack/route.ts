import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { fillChecks, markWhatsappSent, setCheck, STATUS_OF, type CheckStatus } from "@/lib/whatsapp-pack";

// The pack's WhatsApp tab. POST {action: "fill"}: take unchecked numbers up to twenty.
// POST {action: "check", id, status: "verified" | "asked" | "false"}: the number's check, as the person.
// POST {action: "sent", id}: Mark WhatsApp sent on a verified lead, as the person; Peek never sends.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { action?: unknown; id?: unknown; status?: unknown } | null;
  const who = { userId: g.who.userId, name: g.who.name || g.who.email };
  const id = typeof b?.id === "string" && /^[0-9a-f-]{36}$/i.test(b.id) ? b.id : null;
  try {
    const d = await db();
    if (b?.action === "fill") return NextResponse.json({ ok: true, added: await fillChecks(d, g.who.tenantId, who.userId) });
    if (b?.action === "check" && id && typeof b.status === "string" && b.status in STATUS_OF) {
      const r = await setCheck(d, g.who.tenantId, id, b.status as CheckStatus, who);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    if (b?.action === "sent" && id) {
      const r = await markWhatsappSent(d, g.who.tenantId, id, who);
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    return NextResponse.json({ ok: false, error: 'send {action: "fill"}, {action: "check", id, status} or {action: "sent", id}' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "whatsapp-pack") }, { status: 500 });
  }
}
