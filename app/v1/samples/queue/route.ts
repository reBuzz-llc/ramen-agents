import { NextResponse } from "next/server";
import { failed, keyed } from "@/lib/board-api";
import { QUEUE_ORDER, sampleQueue } from "@/lib/samples";

// GET /v1/samples/queue?limit=N (board:write, the Site Builder's key): what to make
// next, in order -- pack (in a person's send pack, no sample), changes (a person's note), replied (a Starter Website lead
// that answered, no sample), recopy (the name, pain point or listing kind changed since the copy), backlog (no-site rows
// with a package and no sample, oldest first). Each item: {leadId, sampleId, reason, family, facts, note?}. The read also
// freezes the samples of leads that answered and re-renders a few whose facts changed by import, so it needs write.
export async function GET(req: Request) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const limit = Number(new URL(req.url).searchParams.get("limit") ?? 20);
  try {
    return NextResponse.json({ order: QUEUE_ORDER, items: await sampleQueue(k.d, k.key.tenantId, limit) });
  } catch (err) {
    return failed(err, "v1.samples.queue");
  }
}
