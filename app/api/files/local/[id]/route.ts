import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getFile, MAX_BYTES } from "@/lib/files";
import { guard } from "@/lib/guard";
import { readLocal, storage, writeLocal } from "@/lib/storage";

// The local stand-in for the bucket (development on this Mac and the tests; never on the live app): PUT the bytes of
// your own pending upload, GET a ready file. 404 whenever the real bucket is in use.
async function local() {
  const st = await storage();
  return st?.kind === "local";
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await local())) return NextResponse.json({ error: "not found" }, { status: 404 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const f = await getFile(await db(), g.who.tenantId, (await ctx.params).id);
  if (!f || f.status !== "pending" || f.uploadedBy !== g.who.userId) return NextResponse.json({ error: "no upload waiting" }, { status: 404 });
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength > MAX_BYTES) return NextResponse.json({ error: "over 25 MB" }, { status: 413 });
  await writeLocal(f.key, bytes);
  return new NextResponse(null, { status: 200 });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!(await local())) return NextResponse.json({ error: "not found" }, { status: 404 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const f = await getFile(await db(), g.who.tenantId, (await ctx.params).id);
  if (!f || f.status !== "ready") return NextResponse.json({ error: "not found" }, { status: 404 });
  const inline = new URL(req.url).searchParams.get("inline") === "1";
  return new NextResponse(new Uint8Array(await readLocal(f.key)), {
    headers: { "Content-Type": f.contentType, "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}` },
  });
}
