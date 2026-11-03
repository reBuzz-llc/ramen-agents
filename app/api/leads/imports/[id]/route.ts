import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/guard";
import { importReportCsv } from "@/lib/lead-import";

// GET: a kept import's report as CSV (row, business, outcome, reason).
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard("leads.import");
  if ("res" in g) return g.res;
  const r = await importReportCsv(await db(), g.who.tenantId, (await ctx.params).id);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(r.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${r.name}"` } });
}
