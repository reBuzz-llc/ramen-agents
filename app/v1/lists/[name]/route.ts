import { NextResponse } from "next/server";
import { body, fail, failed, keyed } from "@/lib/board-api";
import { NOTION_GONE } from "@/lib/leads";
import { LIST as RESEARCH_FIRST, listProblem } from "@/lib/research-first";
import { notionOnly, saveList } from "@/lib/send-next";

// PUT a list a machine keeps, as its file has it; the key's company only.
//   send-next: the Validator's {generated_at, next: [{id, note?}], held: [{id, name, reason}], counts}; the Leads page's
//     Send next tab shows it.
//   research-first: the Validator's {generated_at, bar, next: [{id, since, score}]}: own-site leads above its
//     bar that wait for a person's pain point; the Leads page's Research first tab shows them, and a bot's pain point or
//     draft on one of them is refused (lib/research-first.ts).
const LISTS = ["send-next", RESEARCH_FIRST];

export async function PUT(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const name = (await ctx.params).name;
  if (!LISTS.includes(name)) return fail(404, "not_found", `the lists here are: ${LISTS.join(", ")}`);
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b || !Array.isArray(b.next)) return fail(400, "bad_request", name === RESEARCH_FIRST ? "send the list: {generated_at, bar, next: [{id, since, score}]}" : "send the list: {generated_at, next: [...], held: [...]}");
  // a late caller still naming leads by their Notion page id: refused, so it shows in the log (the column was dropped)
  if (b.next.some(notionOnly)) return fail(400, "bad_request", NOTION_GONE);
  if (name === RESEARCH_FIRST) {
    const problem = listProblem(b);
    if (problem) return fail(problem.startsWith("at most") ? 413 : 400, problem.startsWith("at most") ? "too_large" : "bad_request", problem);
  } else if (b.next.length > 500 || (Array.isArray(b.held) && b.held.length > 500)) return fail(413, "too_large", "at most 500 entries in next and in held");
  try {
    await saveList(k.d, k.key.tenantId, name, b, k.key.name);
    return NextResponse.json({ ok: true, next: b.next.length });
  } catch (err) {
    return failed(err, "v1.lists");
  }
}
