import { NextResponse } from "next/server";
import { body, fail, failed, keyed } from "@/lib/board-api";
import { NOT_COMPLETE_MAX, notCompleteReason } from "@/lib/sample-labels";
import { SampleError, saveDraft } from "@/lib/samples";

// POST /v1/samples/drafts {leadId | lead_id, family? | template?, copy, by?} (board:write, the Site Builder's key): the
// agent's copy for a no-site lead's free sample page. Peek checks the copy (no address, email, phone, price, quoted
// review, person's name or "best" claim), renders the page from the lead's row and the trade template (lib/samples.ts),
// and keeps it as a draft for a person. One open draft per lead: 409 while one waits; a draft sent back for changes is
// replaced as the next version. Answers {sample: {id, slug, template, status, version, ...}}. The copy is
// {headline, about, cta} (the older shape still taken) and `family` one of eat, shop, services, care, plain.
// {leadId, html, changes?, sources?, signature?, designReason?, family?, by?} -- the Site Builder's
// own whole page (at most 300 KB), checked (lib/sample-page.ts checkPage) and kept as it is; copy is then optional. Posting
// a page for a lead whose draft still waits replaces it as the next version (the Site Builder improving its own draft).
// pages?: [{path: "<name>/index.html", html}] -- at most 3 extra pages (a gallery), each checked like the main
// page and published at <slug>/<name>/; their pictures are copied with the main page's at Approve.
// notComplete?: one reason line of at most 300 characters, on a page: the version arrived
// incomplete, so it closes no request whatever `answers` says, stays changes_requested and cannot be approved until a later
// version comes without it. And `answers` is now the only thing that closes a request: missing or [] closes none.
export async function POST(req: Request) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  const leadId = typeof b?.leadId === "string" ? b.leadId : typeof b?.lead_id === "string" ? b.lead_id : "";
  if (!b || !leadId) return fail(400, "bad_request", "send {leadId, html, changes?, sources?, signature?, designReason?} or {leadId, family?, copy: {headline, about, cta}}");
  const by = typeof b.by === "string" && b.by.trim() ? b.by.trim().slice(0, 80) : k.key.name;
  try {
    // a list -- exactly those; missing or [] -- none
    if (b.notComplete !== undefined && (b.html === undefined || !notCompleteReason(b.notComplete))) return fail(400, "bad_request", `notComplete goes with a page and is one reason line of 1 to ${NOT_COMPLETE_MAX} characters`);
    if (b.answers !== undefined && (!Array.isArray(b.answers) || b.answers.some((x: unknown) => typeof x !== "string"))) return fail(400, "bad_request", "answers is a list of change-request ids ([] answers none)");
    const page = b.html !== undefined ? { html: b.html, changes: b.changes, sources: b.sources, signature: b.signature, designReason: b.designReason ?? b.design_reason, pages: b.pages, answers: b.answers, notComplete: b.notComplete } : undefined;
    return NextResponse.json({ sample: await saveDraft(k.d, k.key.tenantId, leadId, b.family ?? b.template, b.copy, by, undefined, page) }, { status: 201 });
  } catch (err) {
    if (err instanceof SampleError) return fail(err.status, err.status === 409 ? "conflict" : err.status === 404 ? "not_found" : "bad_request", err.message);
    return failed(err, "v1.samples.drafts");
  }
}
