import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { changeFile, deleteFile, finishUpload, getFile } from "@/lib/files";
import { guard } from "@/lib/guard";
import { sameOrigin } from "@/lib/same-origin";
import { NOT_SET_UP, storage } from "@/lib/storage";
import { displayName } from "@/lib/display-name";

// POST {action: "done"} after the upload; {action: "rename", name}; {action: "tag", tag}; {action: "delete"}.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const st = await storage();
  if (!st) return NextResponse.json({ ok: false, error: NOT_SET_UP }, { status: 503 });
  const b = (await req.json().catch(() => null)) as { action?: string; name?: string; tag?: string } | null;
  const { id } = await ctx.params;
  const d = await db();
  const who = { userId: g.who.userId, name: displayName(g.who.name, g.who.email), role: g.who.role };
  try {
    if (b?.action === "done") {
      const [f] = await Promise.all([getFile(d, g.who.tenantId, id)]);
      const r = await finishUpload(d, g.who.tenantId, id, who, f ? await st.size(f.key) : null);
      return NextResponse.json(r, { status: r.ok ? 200 : 400 });
    }
    if (b?.action === "rename" || b?.action === "tag") {
      const r = await changeFile(d, g.who.tenantId, id, who, b.action === "rename" ? { name: String(b.name ?? "") } : { tag: String(b.tag ?? "") });
      return NextResponse.json(r, { status: r.ok ? 200 : 403 });
    }
    if (b?.action === "delete") {
      const r = await deleteFile(d, g.who.tenantId, id, who);
      if (!r.ok) return NextResponse.json(r, { status: 403 });
      await st.remove(r.key).catch((err) => console.error("[files.delete] object", err));
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: "action is done, rename, tag or delete" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "files.change") }, { status: 500 });
  }
}
