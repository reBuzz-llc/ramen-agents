import { originOf } from "@/lib/google-signin";
import { me } from "@/lib/auth";
import { db } from "@/lib/db";
import { withNext } from "@/lib/return-path";
import { can } from "@/lib/roles";
import { pageCsp } from "@/lib/sample-page";
import { sampleDoc, withPhotos } from "@/lib/samples";
import { previewPage } from "@/lib/sample-pages";

// GET /samples/<id>/preview: "Open site" on the Samples page, in its own tab -- exactly the html the
// Mac's publisher would deploy (the stored current version; ?v=<n> an earlier one), never public: signed in, else off to
// sign-in and back here. noindex, and the page's own CSP (pageCsp): a Site Builder page's one menu script by its
// hash, its photo hosts and Google Fonts, nothing to connect to; a template page no script and nothing from outside; its links
// (WhatsApp, Maps) may open their own tabs.

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const here = `/samples/${encodeURIComponent(id)}/preview${url.search}`;
  const who = await me();
  if (!who) return Response.redirect(new URL(withNext("/sign-in", here), originOf(req)), 303);
  if (!who.acked) return Response.redirect(new URL(withNext("/welcome", here), originOf(req)), 303);
  if (!can(who.role, "queue.work")) return new Response("your role cannot see samples", { status: 403 });
  const v = Number(url.searchParams.get("v"));
  const doc = await sampleDoc(await db(), who.tenantId, id, Number.isInteger(v) && v > 0 ? v : undefined).catch(() => null);
  // ?page=<name>: one of its extra pages, links between the pages kept inside the preview
  const raw = doc && previewPage(doc, url.searchParams.get("page"), Number.isInteger(v) && v > 0 ? v : undefined);
  if (!doc || raw === null) return new Response("no such sample", { status: 404, headers: { "x-robots-tag": "noindex, nofollow" } });
  // the sample's edited photos inline (the sandboxed preview cannot fetch them signed in)
  const html = await withPhotos(await db(), who.tenantId, id, raw);
  return new Response(html, {
    headers: { "content-type": "text/html; charset=utf-8", "content-security-policy": pageCsp(html, doc.kind), "x-robots-tag": "noindex, nofollow", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
