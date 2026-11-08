import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { listFiles, startUpload } from "@/lib/files";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { NOT_SET_UP, storage } from "@/lib/storage";
import { displayName } from "@/lib/display-name";

// POST {name, size, type, tag?}: start an upload. Answers {id, upload: {url, headers}}: the browser PUTs the bytes there
// (straight to the bucket), then POSTs {action: "done"} to /api/files/{id}.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const st = await storage();
  if (!st) return NextResponse.json({ ok: false, error: NOT_SET_UP }, { status: 503 });
  const b = (await req.json().catch(() => null)) as { name?: string; size?: number; type?: string; tag?: string } | null;
  try {
    const r = await startUpload(await db(), g.who.tenantId, { userId: g.who.userId, name: displayName(g.who.name, g.who.email), role: g.who.role }, { name: String(b?.name ?? ""), size: Number(b?.size), type: String(b?.type ?? ""), tag: String(b?.tag ?? "") });
    if (!r.ok) return NextResponse.json(r, { status: 400 });
    return NextResponse.json({ ok: true, id: r.file.id, upload: await st.uploadUrl(r.file.key, r.file.contentType, r.file.id) });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "files.start") }, { status: 500 });
  }
}

// GET: the company's files for a picker (the lead drawer's "Attach a file").
export async function GET() {
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const rows = await listFiles(await db(), g.who.tenantId);
  return NextResponse.json({ files: rows.map((f) => ({ id: f.id, name: f.name, tag: f.tag })) }, { headers: { "Cache-Control": "no-store" } });
}
