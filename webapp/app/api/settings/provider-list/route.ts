import { cleanKey } from "@/lib/keys";
import { needsTermsScript, TERMS_FIRST } from "@/lib/key-terms";
import { needsConfirm } from "@/lib/providers-list";
import {
  deleteProviderKey, findEntry, providerRows, readProviderKey, saveProviderKey, testProviderKey, writeOwnMark,
} from "@/lib/providers-store";
import { sameOrigin } from "@/lib/same-origin";

// Settings -> Providers -> All providers: every provider in common-data/providers.json, with key presence only. A key is
// read here, saved private, tested with a free read, or moved to keys/deleted/; it never travels back to the page.
const NO_STORE = { "cache-control": "no-store" };
const lastTest = new Map<string, number>();

export async function GET() {
  return Response.json(await providerRows(), { headers: NO_STORE });
}

type Body = { action?: unknown; name?: unknown; key?: unknown; confirm?: unknown; mark?: unknown; note?: unknown };

export async function POST(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  const p = typeof body.name === "string" ? await findEntry(body.name) : null;
  if (!p) return Response.json({ error: "not a provider on the list" }, { status: 400 });

  if (body.action === "save") {
    if (needsTermsScript(p.name)) return Response.json({ error: TERMS_FIRST }, { status: 400, headers: NO_STORE });
    if (p.status === "removed") return Response.json({ error: `${p.who} is no longer used` }, { status: 400 });
    if (needsConfirm(p) && body.confirm !== true) return Response.json({ error: "confirm", note: p.mark_note }, { status: 409, headers: NO_STORE });
    const key = cleanKey(body.key);
    if (!key) return Response.json({ error: "That doesn't look like an API key: 16 to 512 characters, no spaces." }, { status: 400 });
    try {
      await saveProviderKey(p, key);
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : "could not save the key" }, { status: 500 });
    }
    return Response.json({ ok: true, ending: key.slice(-4) }, { headers: NO_STORE });
  }

  if (body.action === "test") {
    const now = Date.now();
    if (now - (lastTest.get(p.name) ?? 0) < 3000) return Response.json({ error: "Wait a moment before testing again." }, { status: 429 });
    lastTest.set(p.name, now);
    const key = await readProviderKey(p);
    if (!key) return Response.json({ ok: false, level: "untested", message: "No saved key to test." }, { headers: NO_STORE });
    return Response.json(await testProviderKey(p, key), { headers: NO_STORE });
  }

  if (body.action === "delete") {
    if (body.confirm !== p.name) return Response.json({ error: `Type ${p.name} to delete its key.` }, { status: 400 });
    if (!(await readProviderKey(p))) return Response.json({ error: "No saved key to delete." }, { status: 400 });
    try {
      const kept = await deleteProviderKey(p);
      return Response.json({ ok: true, kept: `common-data/keys/deleted/${kept}` }, { headers: NO_STORE });
    } catch (err) {
      return Response.json({ error: err instanceof Error ? err.message : "could not delete the key" }, { status: 500 });
    }
  }

  if (body.action === "mark") {
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 300) : "";
    if (body.mark === "clear") await writeOwnMark(p.name, null);
    else if (body.mark === "unusable" || body.mark === "needs-billing") await writeOwnMark(p.name, { mark: body.mark, note, at: new Date().toISOString().slice(0, 10) });
    else return Response.json({ error: "mark: unusable, needs-billing or clear" }, { status: 400 });
    return Response.json({ ok: true }, { headers: NO_STORE });
  }

  return Response.json({ error: "action: save, test, delete or mark" }, { status: 400 });
}
