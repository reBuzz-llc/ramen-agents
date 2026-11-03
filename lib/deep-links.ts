// The links bots record: <peek>/tasks/<id> and <peek>/leads/<id>. Each resolves to the page
// that shows it, or to "missing": no such id in the signed-in person's company (another company's id is missing too,
// never a hint that it exists).
import { and, eq } from "drizzle-orm";
import type { Db } from "./db";
import { leads, tasks } from "./db/schema";

export type Link = { to: string } | { missing: true };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A task: Our queue with its card open (a closed one says so there, with its status). */
export async function taskLink(db: Db, tenantId: string, id: string): Promise<Link> {
  if (!UUID.test(id)) return { missing: true };
  const [t] = await db.select({ status: tasks.status }).from(tasks).where(and(eq(tasks.tenantId, tenantId), eq(tasks.id, id)));
  return t ? { to: `/queue?task=${id}&status=${encodeURIComponent(t.status)}#tasks` } : { missing: true };
}

/** A lead: the Leads board with its drawer open. */
export async function leadLink(db: Db, tenantId: string, id: string): Promise<Link> {
  if (!UUID.test(id)) return { missing: true };
  const [l] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.tenantId, tenantId), eq(leads.id, id)));
  return l ? { to: `/leads?open=${id}` } : { missing: true };
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** The 404 a missing link answers: a small page of its own (a real 404 status, which a streamed app page cannot give),
 *  in the app's colours (app/globals.css), light or dark, with the way back. */
export function missingPage(what: "task" | "lead", back: { href: string; label: string }) {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>No such ${what} · ramen-agents</title>
<style>:root{--bg:rgb(250 249 247);--ink:rgb(24 22 20);--muted:rgb(104 98 92);--accent:#b34700}@media (prefers-color-scheme:dark){:root{--bg:rgb(20 17 15);--ink:rgb(246 241 233);--muted:rgb(170 162 152);--accent:#ff6600}}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,sans-serif}main{max-width:36rem;margin:0 auto;padding:4rem 1rem}h1{font-size:1.5rem;margin:0}p{color:var(--muted);font-size:15px}a{color:var(--accent);font-weight:600;text-decoration:none}a:hover{text-decoration:underline}</style></head>
<body><main><p style="margin:0 0 1rem"><a href="/">ramen-agents</a></p><h1>No such ${what}</h1><p>This link names a ${what} that is not on your company's board: it may have been removed, or the link is from another company.</p><p><a href="${esc(back.href)}">← Back to ${esc(back.label)}</a></p></main></body></html>`;
  return new Response(html, { status: 404, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
