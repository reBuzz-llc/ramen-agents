import { findBot } from "@/lib/bots";
import { MAX_BIO_CHARS, MAX_PERSONA_BYTES, PersonaConflict, PersonaInvalid, readPersona, savePersona } from "@/lib/persona";
import { sameOrigin } from "@/lib/same-origin";

const NO_STORE = { "cache-control": "no-store" };

export async function GET(_req: Request, ctx: RouteContext<"/api/bots/[slug]/persona">) {
  const bot = await findBot((await ctx.params).slug);
  if (!bot) return Response.json({ error: "not found" }, { status: 404 });
  return Response.json(await readPersona(bot), { headers: NO_STORE });
}

// Save persona, goals and bio. The bot reads them when it starts, so the page offers a restart after.
export async function PUT(req: Request, ctx: RouteContext<"/api/bots/[slug]/persona">) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  const bot = await findBot((await ctx.params).slug);
  if (!bot) return Response.json({ error: "not found" }, { status: 404 });

  const raw = await req.text();
  if (raw.length > MAX_PERSONA_BYTES * 2 + MAX_BIO_CHARS + 1024) return Response.json({ error: "too large" }, { status: 413 });
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  const { bio, persona, goals, version } = body;
  if (typeof bio !== "string" || typeof persona !== "string" || typeof goals !== "string" || typeof version !== "string") {
    return Response.json({ error: "bio, persona, goals and version must be strings" }, { status: 400 });
  }

  try {
    const result = await savePersona(bot, { bio, persona, goals, version });
    return Response.json(result, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof PersonaConflict) return Response.json({ error: err.message, current: await readPersona(bot) }, { status: 409 });
    if (err instanceof PersonaInvalid) return Response.json({ error: err.message }, { status: 422 });
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
