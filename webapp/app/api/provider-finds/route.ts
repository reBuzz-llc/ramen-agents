import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR } from "@/lib/bots";
import { cleanKey, KEYS_DIR, saveKey, testKey, type ProviderInfo } from "@/lib/keys";
import { changeVerdicts, newFinds, parseFinds, readVerdicts, withMark, type Mark } from "@/lib/provider-finds";
import { sameOrigin } from "@/lib/same-origin";

// Settings > Key providers > New finds (owner, 2026-11-12). GET: the Scout's finds without the owner's mark, and the
// marks. POST {action: "test", slug, endpoint, model, key?}: the page's own key test (list models, one token) with the
// pasted key, else the saved one; the result is kept beside the marks, never the key. POST {action: "save", slug, key}:
// the key into common-data/keys/<slug>.key. POST {action: "mark", name, slug, verdict, note, kind?, url?, free?}: usable or
// unusable, which the blog's /free-ai-apis page shows at its next build.
const NO_STORE = { "cache-control": "no-store" };
const FINDS = () => path.join(/*turbopackIgnore: true*/ BOTS_DIR, "common-data", "providers-found.md");
const VERDICTS = () => path.join(/*turbopackIgnore: true*/ BOTS_DIR, "common-data", "provider-verdicts.json");
const SLUG = /^[a-z0-9][a-z0-9._-]{0,60}$/;
const lastTest = new Map<string, number>();

async function keyNames(): Promise<Set<string>> {
  try {
    return new Set((await readdir(/*turbopackIgnore: true*/ KEYS_DIR)).filter((f) => f.endsWith(".key")).map((f) => f.slice(0, -4)));
  } catch {
    return new Set();
  }
}

/** A public https endpoint only: never this Mac or a private network. */
function publicEndpoint(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" || u.username || u.password) return null;
    if (/^(localhost|.*\.local|.*\.internal|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[)/i.test(u.hostname)) return null;
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

export async function GET() {
  const [md, file, keys] = await Promise.all([readFile(/*turbopackIgnore: true*/ FINDS(), "utf8").catch(() => ""), readVerdicts(VERDICTS()), keyNames()]);
  const decided = [...file.providers].sort((a, b) => b.decided_at.localeCompare(a.decided_at) || a.name.localeCompare(b.name));
  return Response.json({ finds: newFinds(parseFinds(md), file, keys), decided, tests: file.tests }, { headers: NO_STORE });
}

export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  const slug = typeof b.slug === "string" ? b.slug.trim().toLowerCase() : "";
  if (!SLUG.test(slug)) return Response.json({ error: "no such key name" }, { status: 400 });
  const keyFile = path.join(KEYS_DIR, `${slug}.key`);

  if (b.action === "test") {
    const endpoint = publicEndpoint(b.endpoint);
    if (!endpoint) return Response.json({ error: "the endpoint is a public https address, like https://api.example.com/v1" }, { status: 400 });
    const model = typeof b.model === "string" ? b.model.trim().slice(0, 120) : "";
    if (!model) return Response.json({ error: "name a model to ask (one of the find's models)" }, { status: 400 });
    if (Date.now() - (lastTest.get(slug) ?? 0) < 5000) return Response.json({ error: "one test every few seconds" }, { status: 429 });
    lastTest.set(slug, Date.now());
    const key = b.key ? cleanKey(b.key) : cleanKey(await readFile(/*turbopackIgnore: true*/ keyFile, "utf8").catch(() => ""));
    if (!key) return Response.json({ error: b.key ? "that does not look like a key" : "paste the key first (none is saved for it)" }, { status: 400 });
    const p: ProviderInfo = { name: slug, auto: false, note: "", model, baseUrl: endpoint, kind: /generativelanguage\.googleapis\.com/.test(endpoint) ? "gemini" : "openai",
      keyFile, hasKey: true };
    const result = await testKey(p, key);
    await changeVerdicts(VERDICTS(), (f) => ({ ...f, tests: { ...f.tests, [slug]: { at: new Date().toISOString().slice(0, 19), ok: result.ok, level: result.level, message: result.message, endpoint, model } } }));
    return Response.json(result, { headers: NO_STORE });
  }
  if (b.action === "save") {
    const key = cleanKey(b.key);
    if (!key) return Response.json({ error: "that does not look like a key" }, { status: 400 });
    await saveKey({ name: slug, auto: false, note: "", model: "", baseUrl: "", kind: "", keyFile, hasKey: false }, key);
    return Response.json({ ok: true, file: `common-data/keys/${slug}.key`, ending: key.slice(-4) }, { headers: NO_STORE });
  }
  if (b.action === "mark") {
    const m: Mark = {
      name: typeof b.name === "string" ? b.name : slug, slug, verdict: b.verdict === "usable" ? "usable" : b.verdict === "unusable" ? "unusable" : ("" as never),
      note: typeof b.note === "string" ? b.note : "", kind: b.kind === "tool" ? "tool" : b.kind === "model" ? "model" : undefined,
      url: typeof b.url === "string" && b.url.trim() ? b.url.trim() : undefined, free: typeof b.free === "string" ? b.free : undefined,
    };
    const out = await changeVerdicts(VERDICTS(), (f) => withMark(f, m));
    if (typeof out === "string") return Response.json({ error: out }, { status: 400 });
    return Response.json({ ok: true }, { headers: NO_STORE });
  }
  return Response.json({ error: "action is test, save or mark" }, { status: 400 });
}
