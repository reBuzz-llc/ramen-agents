import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/guard";
import { dayBounds, logOf, logPdf, logProject } from "@/lib/project-log";

// GET ?day=YYYY-MM-DD: the project's day of updates as a PDF for the client. Notes are visible to the whole company, so
// anyone on the team may export it; it carries no pay and no screenshots.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard("clock.own");
  if ("res" in g) return g.res;
  const d = await db();
  const project = await logProject(d, g.who.tenantId, (await ctx.params).id);
  if (!project) return NextResponse.json({ error: "not found" }, { status: 404 });
  const day = dayBounds(new URL(req.url).searchParams.get("day"));
  const pdf = logPdf(project, g.who.tenantName, day.day, await logOf(d, g.who.tenantId, project, day));
  const file = `${project.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${day.day}.pdf`;
  return new NextResponse(Buffer.from(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${file}"` } });
}
