import { sameOrigin } from "@/lib/same-origin";
import { decide, type Answer } from "@/lib/owner-decisions";

// Answer one of the owner's decisions: POST {id, action: "choose" | "done" | "later", choice?, note?}. Writes
// shared-state/owner-decisions.json and appends to owner-decisions-log.jsonl. Only this app's own page may call it.
export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: { id?: unknown; action?: unknown; choice?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  const answer: Answer | null =
    body.action === "choose" && typeof body.choice === "string" ? { kind: "choose", choice: body.choice } : body.action === "done" ? { kind: "done" } : body.action === "later" ? { kind: "later" } : null;
  if (typeof body.id !== "string" || !answer) return Response.json({ error: "expected {id, action: choose (with choice) | done | later}" }, { status: 400 });
  try {
    const r = await decide(body.id, answer, typeof body.note === "string" ? body.note : "");
    return r.ok ? Response.json({ item: r.item }) : Response.json({ error: r.error }, { status: 409 });
  } catch (err) {
    return Response.json({ error: `could not save: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
