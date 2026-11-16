// The Validator's Family report (queue 572): POST /v1/family/report {kind, ...} -> {ok, id, at}, kept newest 50 of each
// kind and shown on the dashboard; GET -> the newest of each kind.
import { body, fail, keyed } from "@/lib/board-api";
import { latestReports, saveReport } from "@/lib/local-board";

export async function POST(req: Request) {
  const k = keyed(req);
  if ("res" in k) return k.res;
  const b = await body(req);
  const kind = typeof b?.kind === "string" ? b.kind.trim().slice(0, 40) : "";
  if (!b || !kind) return fail(400, "bad_request", "send {kind, ...}");
  return Response.json({ ok: true, ...saveReport(kind, b) }, { status: 201 });
}

export async function GET(req: Request) {
  const k = keyed(req);
  if ("res" in k) return k.res;
  return Response.json({ reports: latestReports() });
}
