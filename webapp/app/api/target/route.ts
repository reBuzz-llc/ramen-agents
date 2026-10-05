import { sameOrigin } from "@/lib/same-origin";
import { feedMarkets, readTarget, writeTarget } from "@/lib/target";

const NO_STORE = { "cache-control": "no-store" };

// The family's target market (common-data/knowledge/target.toml): GET the five lines, PUT {market, market_short,
// segment, trades, areas} to change them. Only this app's own page may write.
export async function GET() {
  const [target, feeds] = await Promise.all([readTarget(), feedMarkets()]);
  return Response.json({ ...target, feeds }, { headers: NO_STORE });
}

export async function PUT(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  try {
    return Response.json(await writeTarget(body), { headers: NO_STORE });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
