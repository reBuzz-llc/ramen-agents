import { NextResponse } from "next/server";
import { keyed } from "@/lib/board-api";
import { listFiles } from "@/lib/files";

// GET: the company's files, read only, for the bots (the Outreach Writer can name an attachment in a draft): id, name,
// tag, size, type, when. Never a key to the bytes.
export async function GET(req: Request) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const rows = await listFiles(k.d, k.key.tenantId);
  return NextResponse.json({ files: rows.map((f) => ({ id: f.id, name: f.name, tag: f.tag, size: f.size, content_type: f.contentType, created_at: f.createdAt.toISOString() })) });
}
