import { NextResponse } from "next/server";
import { publicReason } from "@/lib/errors";
import { db } from "@/lib/db";
import { guard } from "@/lib/guard";
import { NotionError, searchBoards } from "@/lib/notion";
import { NONE_SHARED, NOT_ACCEPTED } from "@/lib/notion-pick";
import { sameOrigin } from "@/lib/same-origin";
import { notionOf } from "@/lib/tenants";

// POST {token?}: the boards a Notion token can see, for the picker in Settings. An empty token means the one already
// stored for this company. Nothing is saved here; Connect in Settings saves.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const g = await guard("settings.notion");
  if ("res" in g) return g.res;
  const body = (await req.json().catch(() => ({}))) as { token?: string };
  const token = String(body.token ?? "").trim() || (await notionOf(await db(), g.who.tenantId).catch(() => null))?.token;
  if (!token) return NextResponse.json({ ok: false, reason: "Paste your Notion token first." });
  try {
    const boards = await searchBoards(token);
    return NextResponse.json(boards.length ? { ok: true, boards } : { ok: false, reason: NONE_SHARED, boards });
  } catch (err) {
    if (err instanceof NotionError && err.status === 401) return NextResponse.json({ ok: false, reason: NOT_ACCEPTED });
    return NextResponse.json({ ok: false, reason: publicReason(err, "notion.boards") });
  }
}
