import { sameOrigin } from "@/lib/same-origin";
import { decide } from "@/lib/ceo-proposals";

// Approve or decline one of The CEO's open proposals: POST {id, action: "approve" | "decline", note?}. Approve applies
// the change to common-data/work-plan.json. Only this app's own page may call it.
export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: { id?: unknown; action?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  if (typeof body.id !== "string" || (body.action !== "approve" && body.action !== "decline"))
    return Response.json({ error: "expected {id, action: approve | decline}" }, { status: 400 });
  try {
    const r = await decide(body.id, body.action === "approve", typeof body.note === "string" ? body.note : "");
    return r.ok ? Response.json({ proposal: r.proposal }) : Response.json({ error: r.error }, { status: 409 });
  } catch (err) {
    return Response.json({ error: `could not save: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
