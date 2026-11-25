import { db } from "@/lib/db";
import { guard } from "@/lib/guard";
import { handoverOf } from "@/lib/samples";
import { zipStore } from "@/lib/zip";

// GET: the sample's Handover bundle: a zip of index.html, its pictures under assets/ and facts.md (each
// field with its source), for the person who makes the final site after a reply. The team's, never public.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const g = await guard("queue.work");
  if ("res" in g) return g.res;
  const { id } = await ctx.params;
  const b = await handoverOf(await db(), g.who.tenantId, id);
  if (!b) return new Response("no such sample", { status: 404 });
  return new Response(new Uint8Array(zipStore(b.files)), {
    headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${b.slug}-v${b.version}.zip"`, "cache-control": "no-store" },
  });
}
