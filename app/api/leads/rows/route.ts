import { gzipSync } from "node:zlib";
import { NextResponse } from "next/server";
import { cachedRows, boardFingerprint, FIRST_ROWS, gzRows, rowsEtag, slimRow, type RowsTab } from "@/lib/board-cache";
import { heldFingerprint } from "@/lib/board-fp";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";

// GET ?tab=board|table: the person's whole board for the Leads page. The page carries the first
// rows; this brings the rest. An ETag on the board's fingerprint: a browser sending it back gets 304 and no rows while
// nothing changed (one small query); the rows themselves come from the server's copy when it is current.
export async function GET(req: Request) {
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const asked = new URL(req.url).searchParams;
  const tab: RowsTab = asked.get("tab") === "table" ? "table" : "board";
  const first = asked.get("first") === "1"; // a tab opened in the browser asks for its first screenful, then the rest
  try {
    const d = await db();
    // held a minute for bot writes; a person's own write drops it (lib/board-fp.ts)
    const fp = await heldFingerprint(g.who.tenantId, () => boardFingerprint(d, g.who.tenantId));
    const whole = rowsEtag(fp, g.who.userId, tab);
    const etag = first ? whole.replace('W/"rows-', 'W/"first-') : whole;
    const headers = { etag, "cache-control": "private, no-cache", vary: "cookie" };
    if (req.headers.get("if-none-match") === etag) return new NextResponse(null, { status: 304, headers });
    const r = await cachedRows(d, g.who.tenantId, g.who.userId, tab, fp);
    if (first) {
      const rows = r.rows.slice(0, FIRST_ROWS).map((x) => (tab === "table" ? slimRow(x) : x));
      return new NextResponse(new Uint8Array(gzipSync(JSON.stringify({ rows }), { level: 1 })), { headers: { ...headers, "content-type": "application/json", "content-encoding": "gzip", "x-peek-cache": r.hit ? "hit" : "miss" } });
    }
    // gzipped here (the server does not compress a route's own body): the whole board is ~2.7 MB as text, ~0.3 MB gzipped
    if (/\bgzip\b/.test(req.headers.get("accept-encoding") ?? "")) {
      const gz = gzRows(g.who.tenantId, g.who.userId, tab, fp, r.rows);
      return new NextResponse(new Uint8Array(gz), { headers: { ...headers, "content-type": "application/json", "content-encoding": "gzip", "x-peek-cache": r.hit ? "hit" : "miss" } });
    }
    return NextResponse.json({ rows: r.rows }, { headers: { ...headers, "x-peek-cache": r.hit ? "hit" : "miss" } });
  } catch (err) {
    return NextResponse.json({ error: publicReason(err, "leads.rows") }, { status: 500 });
  }
}
