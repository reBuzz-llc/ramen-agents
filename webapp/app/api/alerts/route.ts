import type { NextRequest } from "next/server";
import { alertsView, clearAll, markAllRead, sendTest, setNotify } from "@/lib/alerts";
import { sameOrigin } from "@/lib/same-origin";

const NO_STORE = { "cache-control": "no-store" };

// GET: recent alerts, the unread count and each type's notification switch. ?count=1 returns only the count.
export async function GET(req: NextRequest) {
  const view = await alertsView();
  if (req.nextUrl.searchParams.get("count")) return Response.json({ unread: view.unread }, { headers: NO_STORE });
  return Response.json(view, { headers: NO_STORE });
}

// POST {op: "read-all" | "clear" | "test" | "notify", type?, on?}
export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: { op?: unknown; type?: unknown; on?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  if (body.op === "read-all") await markAllRead();
  else if (body.op === "clear") await clearAll();
  else if (body.op === "test") await sendTest();
  else if (body.op === "notify" && typeof body.type === "string" && typeof body.on === "boolean") {
    if (!(await setNotify(body.type, body.on))) return Response.json({ error: "unknown type" }, { status: 400 });
  } else return Response.json({ error: "unknown op" }, { status: 400 });
  return Response.json({ ok: true, ...(await alertsView()) }, { headers: NO_STORE });
}
