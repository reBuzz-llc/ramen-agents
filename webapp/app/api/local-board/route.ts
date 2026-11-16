// A person's writes on the local board (queue 572), from the dashboard's Leads, Tasks and Packages pages: no key -- the
// dashboard only answers this Mac and the allowed people (proxy.ts, lib/access.ts) -- and the writer is the person, so the
// cell is theirs (an agent's later write to it is refused: person_wins).
//   POST {board, id?, fields, create?, archive?} -> {row, written, refused} | {error}
import { NextResponse } from "next/server";
import { currentIdentity } from "@/lib/identity";
import { FIELDS, writeRow, type Board } from "@/lib/local-board";
import { leadsSource } from "@/lib/portal-config";

const BOARDS = Object.keys(FIELDS) as Board[];

export async function POST(req: Request) {
  if ((await leadsSource()).store !== "local") return NextResponse.json({ error: "The boards live on the hosted portal: edit them there." }, { status: 409 });
  const b = (await req.json().catch(() => null)) as { board?: string; id?: string; fields?: Record<string, unknown>; create?: boolean; archive?: boolean } | null;
  if (!b || !BOARDS.includes(b.board as Board)) return NextResponse.json({ error: "send {board, id?, fields}" }, { status: 400 });
  const who = await currentIdentity();
  const r = writeRow(b.board as Board, { id: b.id }, b.fields ?? {}, { kind: "person", name: who.name || "owner" }, { create: !!b.create, archive: typeof b.archive === "boolean" ? b.archive : undefined });
  if (!r.ok) return NextResponse.json({ error: r.message, code: r.code, existing_id: r.existingId ?? null }, { status: r.code === "not_found" ? 404 : r.code === "duplicate_row" ? 409 : 400 });
  return NextResponse.json({ row: r.row, written: r.written, refused: r.refused });
}
