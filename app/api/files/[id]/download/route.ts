import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getFile } from "@/lib/files";
import { guard } from "@/lib/guard";
import { NOT_SET_UP, storage, storeName } from "@/lib/storage";

// GET ?inline=1 for a preview: a short presigned link to the file (the team only, its own company's files).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const st = await storage();
  if (!st) return NextResponse.json({ ok: false, error: NOT_SET_UP }, { status: 503 });
  const f = await getFile(await db(), g.who.tenantId, (await ctx.params).id);
  if (!f || f.status !== "ready") return NextResponse.json({ ok: false, error: "No such file." }, { status: 404 });
  // stored in the old store and not copied yet: say so, rather than a link that breaks
  if (f.store !== storeName()) {
    const where = f.store === "neon" ? "Neon" : f.store;
    return new NextResponse(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Copy pending</title><body style="font:16px/1.5 system-ui;max-width:32rem;margin:3rem auto;padding:0 1rem"><h1 style="font-size:1.25rem">${f.name.replace(/[<&>"]/g, "")}: copy pending</h1><p>This file is stored on ${where}, and its copy to the new storage has not run yet. It opens here once copied.</p><p><a href="/files">Back to Files</a></p></body>`,
      { status: 409, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }
  const url = await st.downloadUrl(f.key, f.name, f.contentType, new URL(req.url).searchParams.get("inline") === "1", f.id);
  return NextResponse.redirect(new URL(url, req.url), 302);
}
