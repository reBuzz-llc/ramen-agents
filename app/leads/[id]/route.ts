import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { leadLink, leadPath } from "@/lib/deep-links";
import { pageMe } from "@/lib/page-me";

// <peek>/leads/<id>, the link the bots record: signed in (else sign-in), then the Leads board at the lead's canonical
// address /leads?lead=<id>. A lead the person cannot open lands there too, and the page says "That lead isn't available
// to you" instead of a 404 page.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id;
  const who = await pageMe(`/leads/${encodeURIComponent(id)}`);
  const r = await leadLink(await db(), who.tenantId, id);
  redirect("missing" in r ? leadPath(encodeURIComponent(id)) : r.to);
}
