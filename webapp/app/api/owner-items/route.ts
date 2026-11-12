import path from "node:path";
import { BOTS_DIR } from "@/lib/bots";
import { writeSection } from "@/lib/ceo-changes";
import { sameOrigin } from "@/lib/same-origin";
import { markItemDone, ownerItems } from "@/lib/owner-items";

// Mark one of the owner's items done: POST {id}. Sets status "done" and done_ts in shared-state/owner-items.json
// (creatorCC queue 401). POST {id, revert: true} on a persona item (queue 440) first writes the section's `before` back
// into <slug>/persona.md under persona.md.lock, then marks it done. Only this app's own page may call it.
export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: { id?: unknown; revert?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  if (typeof body.id !== "string" || !body.id) return Response.json({ error: "expected {id}" }, { status: 400 });
  try {
    if (body.revert === true) {
      const item = (await ownerItems()).find((i) => i.id === body.id);
      if (!item?.persona) return Response.json({ error: "no persona section to revert on this item" }, { status: 409 });
      const { bot, section, before } = item.persona;
      const err = await writeSection(path.join(BOTS_DIR, bot, "persona.md"), section, null, before);
      if (err) return Response.json({ error: err }, { status: 409 });
    }
    const r = await markItemDone(body.id);
    return r.ok ? Response.json({ ok: true }) : Response.json({ error: r.error }, { status: 409 });
  } catch (err) {
    return Response.json({ error: `could not save: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
