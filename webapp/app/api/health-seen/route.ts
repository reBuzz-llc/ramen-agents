import { sameOrigin } from "@/lib/same-origin";
import { isFactId, markSeen } from "@/lib/health-seen";

// Mark one health banner line seen: POST {id, text}. Writes shared-state/health-seen.json; the line stays hidden until
// its fact changes (queue 54). Only this app's own page may call it.
export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: { id?: unknown; text?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  if (!isFactId(body.id) || typeof body.text !== "string") return Response.json({ error: "expected {id, text}" }, { status: 400 });
  try {
    await markSeen({ id: body.id, text: body.text });
    return Response.json({ ok: true });
  } catch (err) {
    return Response.json({ error: `could not save: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
