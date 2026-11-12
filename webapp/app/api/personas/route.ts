import path from "node:path";
import { BOTS_DIR } from "@/lib/bots";
import { writeSection } from "@/lib/ceo-changes";
import { ownerEdit } from "@/lib/personas";
import { sameOrigin } from "@/lib/same-origin";

// POST {bot, section, before, text} (creatorCC queue 489): the owner's edit of one of their own persona sections, written
// under persona.md.lock and recorded for the Validator's owner-section check; a CEO character section is refused.
export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let b: { bot?: unknown; section?: unknown; before?: unknown; text?: unknown };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  if (typeof b.bot !== "string" || typeof b.section !== "string" || typeof b.before !== "string" || typeof b.text !== "string")
    return Response.json({ error: "send {bot, section, before, text}" }, { status: 400 });
  const shared = path.join(BOTS_DIR, "common-data");
  const err = await ownerEdit(
    { bots: BOTS_DIR, store: path.join(shared, "shared-state", "persona-owner-sections.json"), sections: path.join(shared, "persona-sections.toml") },
    b.bot, b.section, b.before, b.text, writeSection,
  ).catch((e: unknown) => (e instanceof Error ? e.message : "could not save"));
  if (err) return Response.json({ error: err }, { status: /character section/.test(err) ? 403 : 409 });
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
