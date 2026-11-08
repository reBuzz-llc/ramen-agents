import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { filesOfLead, setAttached } from "@/lib/files";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { displayName } from "@/lib/display-name";

// POST {fileId, on}: attach a file to this lead's email, or take it off. Answers the lead's attachments.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { fileId?: string; on?: boolean } | null;
  const { id } = await ctx.params;
  const d = await db();
  try {
    const r = await setAttached(d, g.who.tenantId, id, String(b?.fileId ?? ""), { userId: g.who.userId, name: displayName(g.who.name, g.who.email), role: g.who.role }, b?.on !== false);
    if (!r.ok) return NextResponse.json(r, { status: 400 });
    return NextResponse.json({ ok: true, attachments: await filesOfLead(d, g.who.tenantId, id) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "leads.files") }, { status: 500 });
  }
}
