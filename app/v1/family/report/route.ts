import { NextResponse } from "next/server";
import { body, fail, failed, keyed } from "@/lib/board-api";
import { parseReport, reportAt, saveReport } from "@/lib/family";

// POST {kind: "tick"|"morning"|"week", at?, ...}: the family's report for /family (the Validator's key only, scope
// board:validate). The shapes are at the top of lib/family.ts. Masked text only: a line with an email address, a phone
// number or a web address is refused (400) with the reason. Answers {report: {id, at}}.
export async function POST(req: Request) {
  const k = await keyed(req, "board:validate");
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b) return fail(400, "bad_request", "send a JSON object: {kind, at?, ...} (see lib/family.ts)");
  let report;
  try {
    report = parseReport(b);
  } catch (err) {
    return fail(400, "bad_request", err instanceof Error ? err.message : String(err));
  }
  try {
    return NextResponse.json({ report: await saveReport(k.d, k.key.tenantId, report, reportAt(b.at), k.key.name) });
  } catch (err) {
    return failed(err, "v1.family.report");
  }
}
