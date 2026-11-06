import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { taskLink, missingPage } from "@/lib/deep-links";
import { pageMe } from "@/lib/page-me";

// <peek>/tasks/<id>, the link the bots record: signed in (else sign-in), then Our queue on that task, or a 404 with
// the way back. A route, not a page: the app's pages stream, and a streamed page cannot answer 404.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const id = (await ctx.params).id;
  const who = await pageMe(`/tasks/${encodeURIComponent(id)}`);
  const r = await taskLink(await db(), who.tenantId, id);
  if ("missing" in r) return missingPage("task", { href: "/todo", label: "To-do" });
  redirect(r.to);
}
