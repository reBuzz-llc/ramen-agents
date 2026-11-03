import { NextResponse } from "next/server";
import { accept, release } from "@/lib/claims";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";

// POST {pageId, action: "accept" | "release"}: take a lead before working it, or give it back.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const body = (await req.json().catch(() => ({}))) as { pageId?: string; action?: string };
  if (typeof body.pageId !== "string" || !/^[0-9a-f-]{32,36}$/i.test(body.pageId) || !["accept", "release"].includes(String(body.action))) {
    return NextResponse.json({ ok: false, error: "pageId and action (accept or release) are needed" }, { status: 400 });
  }
  const d = await db();
  try {
    if (body.action === "accept") {
      const r = await accept(d, g.who.tenantId, body.pageId, g.who.userId);
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: `${r.takenBy} accepted this one first.` }, { status: 409 });
    }
    const r = await release(d, g.who.tenantId, body.pageId, { userId: g.who.userId, role: g.who.role });
    return NextResponse.json(r, { status: r.ok ? 200 : 403 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "queue.claim") }, { status: 500 });
  }
}
