import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { leadLink, missingPage } from "@/lib/deep-links";
import { pageMe } from "@/lib/page-me";

// <peek>/leads/<id>, the link the bots record: signed in (else sign-in), then the Leads board on that lead, or a 404 with
// the way back. A route, not a page: the app's pages stream, and a streamed page cannot answer 404.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id;
  const who = await pageMe(`/leads/${encodeURIComponent(id)}`);
  const r = await leadLink(await db(), who.tenantId, id);
  if ("missing" in r) return missingPage("lead", { href: "/leads", label: "the Leads board" });
  redirect(r.to);
}
