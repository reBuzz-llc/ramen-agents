import { liveBoard } from "@/lib/board-read";

// The live family board for the home page: polled every 12 s, read-only.
export async function GET() {
  try {
    return Response.json(await liveBoard(), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: `could not read the family: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
