import { NextResponse } from "next/server";
import { checkPackages, checkRates, knownIds, listPackages, listRates, savePackages, saveRates } from "@/lib/assets";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";

// PUT from the Asset page: the whole list as the owner or a manager left it ({rates: [...]} or {packages: [...]}),
// written as them; the answer is the list as saved, with its ids. `known` is the ids the page loaded: a row added since
// (a bot's handed-over draft) is kept, not deleted.
export async function PUT(req: Request, ctx: { params: Promise<{ list: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const list = (await ctx.params).list;
  if (list !== "rates" && list !== "packages") return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  const g = await guard("assets.edit");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const d = await db();
  const by = g.who.name || g.who.email;
  try {
    if (list === "rates") {
      const c = checkRates(b?.rates);
      if (!c.ok) return NextResponse.json({ ok: false, error: c.message }, { status: 400 });
      const r = await saveRates(d, g.who.tenantId, c.items, by, knownIds(b?.known));
      if (!r.ok) return NextResponse.json({ ok: false, error: r.message }, { status: 409 });
      return NextResponse.json({ ok: true, rates: await listRates(d, g.who.tenantId) });
    }
    const c = checkPackages(b?.packages);
    if (!c.ok) return NextResponse.json({ ok: false, error: c.message }, { status: 400 });
    const r = await savePackages(d, g.who.tenantId, c.items, by, knownIds(b?.known));
    if (!r.ok) return NextResponse.json({ ok: false, error: r.message }, { status: 409 });
    return NextResponse.json({ ok: true, packages: await listPackages(d, g.who.tenantId) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "assets.save") }, { status: 500 });
  }
}
