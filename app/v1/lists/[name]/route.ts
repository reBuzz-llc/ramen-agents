import { NextResponse } from "next/server";
import { body, fail, failed, keyed } from "@/lib/board-api";
import { saveList } from "@/lib/send-next";

// PUT the Validator's send-next list ({generated_at, next: [{id | notion_page_id, note?}], held: [{id, name, reason}],
// counts}), as its file has it; the Leads page's Send next tab shows it. The key's company only.
export async function PUT(req: Request, ctx: { params: Promise<{ name: string }> }) {
  if ((await ctx.params).name !== "send-next") return fail(404, "not_found", "the lists here are: send-next");
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b || !Array.isArray(b.next)) return fail(400, "bad_request", "send the list: {generated_at, next: [...], held: [...]}");
  if (b.next.length > 500 || (Array.isArray(b.held) && b.held.length > 500)) return fail(413, "too_large", "at most 500 entries in next and in held");
  try {
    await saveList(k.d, k.key.tenantId, "send-next", b, k.key.name);
    return NextResponse.json({ ok: true, next: b.next.length });
  } catch (err) {
    return failed(err, "v1.lists");
  }
}
