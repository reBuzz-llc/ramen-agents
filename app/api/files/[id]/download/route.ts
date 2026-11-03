import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getFile } from "@/lib/files";
import { guard } from "@/lib/guard";
import { NOT_SET_UP, storage } from "@/lib/storage";

// GET ?inline=1 for a preview: a short presigned link to the file (the team only, its own company's files).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const st = await storage();
  if (!st) return NextResponse.json({ ok: false, error: NOT_SET_UP }, { status: 503 });
  const f = await getFile(await db(), g.who.tenantId, (await ctx.params).id);
  if (!f || f.status !== "ready") return NextResponse.json({ ok: false, error: "No such file." }, { status: 404 });
  const url = await st.downloadUrl(f.key, f.name, f.contentType, new URL(req.url).searchParams.get("inline") === "1", f.id);
  return NextResponse.redirect(new URL(url, req.url), 302);
}
