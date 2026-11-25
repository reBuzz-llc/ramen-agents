import { db } from "@/lib/db";
import { guard } from "@/lib/guard";
import { withFinger } from "@/lib/sample-finger";
import { pageCsp } from "@/lib/sample-page";
import { sampleDoc, withPhotos } from "@/lib/samples";
import { previewPage } from "@/lib/sample-pages";

// GET: the sample page itself, for the team's preview iframe. Sandboxed by its own CSP (lib/sample-page.ts
// pageCsp: a Site Builder page's one menu script by hash, its photo hosts and Google Fonts; a template page no script,
// no forms, nothing loaded from anywhere; never public (publishing is separate).
// ?v=<version>: that version (the current one or one kept in sample_versions).
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const { id } = await ctx.params;
  const v = Number(new URL(req.url).searchParams.get("v"));
  const doc = await sampleDoc(await db(), g.who.tenantId, id, Number.isInteger(v) && v > 0 ? v : undefined);
  // ?page=<name>: one of its extra pages, links between the pages kept inside the preview
  const raw = doc && previewPage(doc, new URL(req.url).searchParams.get("page"), Number.isInteger(v) && v > 0 ? v : undefined);
  if (!doc || raw === null) return new Response("no such sample", { status: 404 });
  // the sample's edited photos inline (the sandboxed preview cannot fetch them signed in)
  const page = await withPhotos(await db(), g.who.tenantId, id, raw);
  // ?finger=1: the Phone preview, where the mouse drags like a finger (this response only, never the stored page)
  const html = new URL(req.url).searchParams.get("finger") === "1" ? withFinger(page, doc.kind) : page;
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": pageCsp(html, doc.kind),
               "x-robots-tag": "noindex, nofollow", "cache-control": "no-store" },
  });
}
