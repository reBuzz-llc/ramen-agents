import { NextResponse } from "next/server";
import { failed, keyed } from "@/lib/board-api";
import { latestReports } from "@/lib/family";

// GET: {tick, morning, week}, the newest report of each kind with its `at`, or null where none has come yet.
export async function GET(req: Request) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  try {
    return NextResponse.json(await latestReports(k.d, k.key.tenantId));
  } catch (err) {
    return failed(err, "v1.family.latest");
  }
}
