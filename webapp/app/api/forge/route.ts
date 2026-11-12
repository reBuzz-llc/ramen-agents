import path from "node:path";
import { BOTS_DIR, listBots } from "@/lib/bots";
import { appendLine, decisionLines, readForge } from "@/lib/forge";
import { sameOrigin } from "@/lib/same-origin";

// POST {id, status: "build" | "later" | "no", note} (creatorCC queue 478): the owner's decision on a member's wish in the
// Forge. One decision line appended to common-data/shared-state/forge.jsonl; Build also appends the wish to
// forge-queue.md for creatorCC. The Validator tells the member on its next run.
const STATE = () => path.join(/*turbopackIgnore: true*/ BOTS_DIR, "common-data", "shared-state");

export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let b: { id?: unknown; status?: unknown; note?: unknown };
  try {
    b = (await req.json()) as typeof b;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  const file = path.join(STATE(), "forge.jsonl");
  const wish = (await readForge(file)).find((w) => w.id === b.id);
  const member = wish ? (await listBots().catch(() => [])).find((x) => x.slug === wish.for)?.name ?? wish.for : "";
  const out = decisionLines(wish, String(b.status ?? ""), typeof b.note === "string" ? b.note : "", new Date(), member);
  if (typeof out === "string") return Response.json({ error: out }, { status: out === "no such wish" ? 404 : 400 });
  await appendLine(file, out.line);
  if (out.queue) await appendLine(path.join(STATE(), "forge-queue.md"), out.queue);
  return Response.json({ ok: true }, { headers: { "cache-control": "no-store" } });
}
