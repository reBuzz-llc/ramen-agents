import { undo } from "@/lib/ceo-changes";
import { currentIdentity } from "@/lib/identity";
import { sameOrigin } from "@/lib/same-origin";

// Undo one of The CEO's own changes: POST {id} (valiCC queue 411). Writes `before` back to work-plan.json or
// daily-goals.json when the live value is still the change's `after`, then marks the record undone (undone_at,
// undone_by = who is signed in). 409 with "changed since: undo it by hand" when it is not. Only this app's own page.
export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: { id?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) return Response.json({ error: "expected {id}" }, { status: 400 });
  try {
    const who = await currentIdentity();
    const r = await undo(body.id, who.name);
    return r.ok ? Response.json({ change: r.change }) : Response.json({ error: r.error }, { status: 409 });
  } catch (err) {
    return Response.json({ error: `could not save: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
