import { NextResponse } from "next/server";
import { failed, keyed } from "@/lib/board-api";
import { markPublishPoll, publishQueue } from "@/lib/samples";

// GET /v1/samples/publish (board:write, the engine's key): the pages that should be up -- approved
// and live, with their html, a live one past 30 days marked expired -- and the taken-down ones still on the web. Read by
// the Mac's scripts/samples-publish.py, which holds the Cloudflare token; its real runs ask with ?run=1.
export async function GET(req: Request) {
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  try {
    // when the publisher last ran, so the Samples page can say whether an Approve goes up soon. Only
    // its real run says so (?run=1); a dry run or any other reader of this list does not count as publishing
    if (new URL(req.url).searchParams.get("run") === "1") await markPublishPoll(k.d, k.key.tenantId).catch(() => {});
    return NextResponse.json({ samples: await publishQueue(k.d, k.key.tenantId) });
  } catch (err) {
    return failed(err, "v1.samples.publish");
  }
}
