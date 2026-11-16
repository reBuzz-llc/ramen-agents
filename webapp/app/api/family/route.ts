import { answersOf, applyAnswers, familyMissing, readFamily, saveFamily } from "@/lib/family";
import { sameOrigin } from "@/lib/same-origin";

const NO_STORE = { "cache-control": "no-store" };

// Your family's answers (common-data/local/family.toml, git-ignored; queue 572): GET them, PUT the first-run page's
// form to save them. Only this app's own page may write. The same file sh scripts/setup.sh writes.
export async function GET() {
  const f = await readFamily();
  return Response.json({ answers: answersOf(f), missing: familyMissing(f) }, { headers: NO_STORE });
}

export async function PUT(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  try {
    const next = applyAnswers(await readFamily(), body);
    await saveFamily(next);
    return Response.json({ answers: answersOf(next), missing: familyMissing(next) }, { headers: NO_STORE });
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : String(err) }, { status: 400 });
  }
}
