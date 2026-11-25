import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/display-name";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { SampleError, undoTakedown } from "@/lib/samples";

// POST {cleared?}: a taken-down sample goes back to where it was, its versions untouched; the publisher puts it up
// at the same address on its next run. Anyone on the team (samples.review). When the business or a photographer asked for the
// take-down, `cleared: true` says the person checked with them.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("samples.review");
  if ("res" in g) return g.res;
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ ok: false, error: "no such sample" }, { status: 404 });
  const b = (await req.json().catch(() => null)) as { cleared?: unknown } | null;
  try {
    const sample = await undoTakedown(await db(), g.who.tenantId, id, { name: displayName(g.who.name, g.who.email) }, b?.cleared === true);
    return NextResponse.json({ ok: true, sample });
  } catch (err) {
    if (err instanceof SampleError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: publicReason(err, "samples.undo-takedown") }, { status: 500 });
  }
}
