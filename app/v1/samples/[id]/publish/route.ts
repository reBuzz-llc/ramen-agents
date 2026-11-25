import { NextResponse } from "next/server";
import { body, fail, failed, keyed } from "@/lib/board-api";
import { reportPublish, SampleError, type PublishReport } from "@/lib/samples";

const REPORTS: PublishReport[] = ["published", "unpublished", "expired", "withdrawn"];

// POST /v1/samples/:id/publish {report: "published", url} | {report: "unpublished"} | {report: "expired"}
// (board:write): the Mac's publisher says what it did. "published" sets an approved sample live with its pages.dev
// address (and the lead's Sample site cell, while that is empty or this sample's own); "expired" takes a page live 30 days
// down; "withdrawn" takes down a sample whose business now has a website (any state); "unpublished" clears the address once
// the page is off the web.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const { id } = await ctx.params;
  const b = await body(req);
  const report = b?.report as PublishReport;
  if (!b || !REPORTS.includes(report)) return fail(400, "bad_request", `send {report: ${REPORTS.join(" | ")}, url?}`);
  try {
    return NextResponse.json({ sample: await reportPublish(k.d, k.key.tenantId, id, report, typeof b.url === "string" ? b.url.trim() : "") });
  } catch (err) {
    if (err instanceof SampleError) return fail(err.status, err.status === 409 ? "conflict" : err.status === 404 ? "not_found" : "bad_request", err.message);
    return failed(err, "v1.samples.publish.report");
  }
}
