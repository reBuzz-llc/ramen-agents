import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { displayName } from "@/lib/display-name";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { clearReference, setReference, setReferenceFamily } from "@/lib/sample-references";
import { SampleError } from "@/lib/samples";

// POST {action: "set" (family?) | "family" (family) | "clear"}: the owner's Reference mark on a sample.
// "set" pins it to the version it has now (again: moves the pin); "family" changes only the kind of business it stands for;
// "clear" takes it off. The owner and managers (samples.reference). Nothing here
// publishes anything.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("samples.reference");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { action?: string; family?: unknown } | null;
  const { id } = await ctx.params;
  const d = await db();
  try {
    if (b?.action === "set") return NextResponse.json({ ok: true, reference: await setReference(d, g.who.tenantId, id, displayName(g.who.name, g.who.email), b.family) });
    if (b?.action === "family") return NextResponse.json({ ok: true, reference: await setReferenceFamily(d, g.who.tenantId, id, b.family) });
    if (b?.action === "clear") {
      await clearReference(d, g.who.tenantId, id);
      return NextResponse.json({ ok: true, reference: null });
    }
    return NextResponse.json({ ok: false, error: "action is set, family or clear" }, { status: 400 });
  } catch (err) {
    if (err instanceof SampleError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    return NextResponse.json({ ok: false, error: publicReason(err, "samples.reference") }, { status: 500 });
  }
}
