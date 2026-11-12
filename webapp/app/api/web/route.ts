import { liveWeb } from "@/lib/web-read";

// The family's web activity for the world's WEB terminal: polled every 12 s, read-only.
export async function GET() {
  try {
    return Response.json(await liveWeb(), { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return Response.json({ error: `could not read the web activity: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
