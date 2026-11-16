// A board as CSV (queue 572), for a spreadsheet or for moving to the hosted portal: GET ?board=leads|tasks|packages.
// The header is each column's label, which the Leads page's Import CSV reads back. A cell that a spreadsheet would run
// as a formula (it starts with = + - @) gets a leading ' so it opens as text: the cells hold text from web pages.
import { csvCell } from "@/lib/csv-import";
import { allRows, FIELDS, type Board } from "@/lib/local-board";

const BOARDS = ["leads", "tasks", "packages"] as const;

export async function GET(req: Request) {
  const board = new URL(req.url).searchParams.get("board") as Board;
  if (!(BOARDS as readonly string[]).includes(board)) return Response.json({ error: "board: leads, tasks or packages" }, { status: 400 });
  const fields = FIELDS[board];
  const lines = [fields.map((f) => csvCell(f.label)).join(",")];
  for (const r of allRows(board)) lines.push(fields.map((f) => csvCell(r[f.key])).join(","));
  const day = new Date().toISOString().slice(0, 10);
  return new Response(lines.join("\r\n") + "\r\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${board}-${day}.csv"`, "cache-control": "no-store" },
  });
}
