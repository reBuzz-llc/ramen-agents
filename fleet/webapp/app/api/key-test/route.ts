import { rename, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR, listBots } from "@/lib/bots";
import { findProvider, providerCatalog, readSavedKey, testKey } from "@/lib/keys";
import { sameOrigin } from "@/lib/same-origin";

// POST {name} (owner, 2026-11-12: a Test button on each key in Key providers -> All keys): the saved key of a provider the
// bots know, tested the page's own way (list models, then a one-token answer). The key never leaves this server.
const lastTest = new Map<string, number>();
const TESTS = () => path.join(/*turbopackIgnore: true*/ BOTS_DIR, "common-data", "shared-state", "key-tests.json");

/** The last test per key, so All keys can say a key answers now although the bots' last call failed (never the key). */
async function remember(name: string, r: { ok: boolean; level: string; message: string }) {
  const d = new Date();
  const at = new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  let all: Record<string, unknown> = {};
  try {
    all = JSON.parse(await readFile(/*turbopackIgnore: true*/ TESTS(), "utf8"));
  } catch {
    /* first test */
  }
  all[name] = { at, ok: r.ok, level: r.level, message: r.message.slice(0, 300) };
  const tmp = `${TESTS()}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(/*turbopackIgnore: true*/ tmp, JSON.stringify(all, null, 1), "utf8");
  await rename(/*turbopackIgnore: true*/ tmp, TESTS());
}

export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  const b = (await req.json().catch(() => null)) as { name?: unknown } | null;
  const name = typeof b?.name === "string" ? b.name : "";
  if (!/^[a-z0-9-]{2,40}$/.test(name)) return Response.json({ error: "no such provider" }, { status: 400 });
  if (Date.now() - (lastTest.get(name) ?? 0) < 5000) return Response.json({ error: "one test every few seconds" }, { status: 429 });
  lastTest.set(name, Date.now());
  // the shared chain is the same for most bots: the first bot whose catalog knows the provider answers
  for (const bot of await listBots()) {
    const p = await providerCatalog(bot).then((c) => findProvider(c, name)).catch(() => null);
    if (!p) continue;
    const key = await readSavedKey(p);
    if (!key) return Response.json({ ok: false, level: "error", message: `No key saved for ${name}: add one under By bot or Finds.` });
    const result = await testKey(p, key);
    await remember(name, result).catch(() => {});
    return Response.json(result, { headers: { "cache-control": "no-store" } });
  }
  return Response.json({ ok: false, level: "error", message: `${name} is not a model provider the bots know: its own check runs with Refresh.` });
}
