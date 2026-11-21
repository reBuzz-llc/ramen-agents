// A CSV of leads into the local board: the body is the file's text. Columns are matched by name; the answer
// says how many leads were added and filled and which columns matched nothing. A filled cell is never overwritten.
import { NextResponse } from "next/server";
import { csvRows } from "@/lib/csv-import";
import { currentIdentity } from "@/lib/identity";
import { importLeads, LEAD_FIELDS } from "@/lib/local-board";
import { leadsSource } from "@/lib/portal-config";

export async function POST(req: Request) {
  if ((await leadsSource()).store !== "local") return NextResponse.json({ error: "The boards live on the hosted portal: import there." }, { status: 409 });
  const text = await req.text();
  if (text.length > 20_000_000) return NextResponse.json({ error: "The file is over 20 MB: split it." }, { status: 413 });
  const { rows, unmatched, columns } = csvRows(text, LEAD_FIELDS);
  if (!columns) return NextResponse.json({ error: "No column matched the board (Business, Website, Business email, Location ...).", unmatched }, { status: 400 });
  const who = await currentIdentity();
  return NextResponse.json({ ...importLeads(rows, { kind: "person", name: who.name || "owner" }), unmatched, rows: rows.length });
}
