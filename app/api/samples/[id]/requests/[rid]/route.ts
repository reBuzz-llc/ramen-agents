import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/display-name";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { closeRequest, reopenRequest, SampleError } from "@/lib/samples";
import { recordPress } from "@/lib/session-press";

// POST {action: "done" | "withdraw"}: a person ends an open change request, or confirms one a round claimed. The person who
// filed it, the owner or a manager (lib/samples.ts closeRequest); the engine's key has no way to do this.
// POST {action: "not-done"}: anyone reviewing samples sends a claimed request back to open.
export async function POST(req: Request, ctx: { params: Promise<{ id: string; rid: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("samples.review");
  if ("res" in g) return g.res;
  const { id, rid } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f-]{36}$/i.test(rid)) return NextResponse.json({ ok: false, error: "no such request" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
  if (body?.action !== "done" && body?.action !== "withdraw" && body?.action !== "not-done") return NextResponse.json({ ok: false, error: "action is done, withdraw or not-done" }, { status: 400 });
  try {
    if (body.action === "not-done") {
      const d = await db();
      const back = await reopenRequest(d, g.who.tenantId, id, rid, { name: displayName(g.who.name, g.who.email) });
      await recordPress(d, g.who, "sample.request", "sample", id);
      return NextResponse.json({ ok: true, ...back });
    }
    const r = await closeRequest(await db(), g.who.tenantId, id, rid, body.action, { name: displayName(g.who.name, g.who.email), userId: g.who.userId, role: g.who.role });
    return NextResponse.json({ ok: true, ...r });
  } catch (err) {
    if (err instanceof SampleError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: publicReason(err, "samples.request.close") }, { status: 500 });
  }
}
