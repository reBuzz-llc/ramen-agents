import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { guard } from "@/lib/guard";
import { draftsOf } from "@/lib/notion";

// GET ?pageId=: one lead's full drafts, read when its card is opened or copied (the queue list carries their start only).
export async function GET(req: Request) {
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const pageId = new URL(req.url).searchParams.get("pageId") ?? "";
  if (!/^[0-9a-f-]{32,36}$/i.test(pageId)) return NextResponse.json({ error: "not a Notion page id" }, { status: 400 });
  const r = await draftsOf(await db(), g.who.tenantId, pageId);
  return r ? NextResponse.json(r) : NextResponse.json({ error: "not found" }, { status: 404 });
}
