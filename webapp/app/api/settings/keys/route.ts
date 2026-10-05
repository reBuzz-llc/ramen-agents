import { findBot } from "@/lib/bots";
import { cleanKey, findProvider, providerCatalog, readSavedKey, saveKey, testKey } from "@/lib/keys";
import { sameOrigin } from "@/lib/same-origin";

const NO_STORE = { "cache-control": "no-store" };
const lastTest = new Map<string, number>();

async function context(req: Request) {
  if (!(await sameOrigin(req))) return { error: Response.json({ error: "forbidden" }, { status: 403 }) };
  let body: { bot?: unknown; name?: unknown; key?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return { error: Response.json({ error: "expected JSON" }, { status: 400 }) };
  }
  const bot = typeof body.bot === "string" ? await findBot(body.bot) : null;
  if (!bot || typeof body.name !== "string" || !/^[a-z0-9-]{2,32}$/.test(body.name)) return { error: Response.json({ error: "unknown bot or provider" }, { status: 400 }) };
  const provider = findProvider(await providerCatalog(bot), body.name);
  if (!provider) return { error: Response.json({ error: `${body.name} is not a provider the bot code knows` }, { status: 400 }) };
  return { provider, body };
}

// Save a key: PUT {bot, name, key}. The response never contains the key.
export async function PUT(req: Request) {
  const ctx = await context(req);
  if (ctx.error) return ctx.error;
  const key = cleanKey(ctx.body.key);
  if (!key) return Response.json({ error: "That doesn't look like an API key: 16 to 512 characters, no spaces." }, { status: 400 });
  try {
    await saveKey(ctx.provider, key);
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : "could not save the key" }, { status: 500 });
  }
  return Response.json({ ok: true, name: ctx.provider.name, ending: key.slice(-4) }, { headers: NO_STORE });
}

// Test a key: POST {bot, name, key?}. Without a key, tests the saved one (read on the server only).
export async function POST(req: Request) {
  const ctx = await context(req);
  if (ctx.error) return ctx.error;
  const now = Date.now();
  if (now - (lastTest.get(ctx.provider.name) ?? 0) < 3000) return Response.json({ error: "Wait a moment before testing again." }, { status: 429 });
  lastTest.set(ctx.provider.name, now);
  const key = ctx.body.key === undefined || ctx.body.key === "" ? await readSavedKey(ctx.provider) : cleanKey(ctx.body.key);
  if (!key) return Response.json({ ok: false, level: "error", message: ctx.body.key ? "That doesn't look like an API key." : "No saved key to test." }, { headers: NO_STORE });
  return Response.json(await testKey(ctx.provider, key), { headers: NO_STORE });
}
