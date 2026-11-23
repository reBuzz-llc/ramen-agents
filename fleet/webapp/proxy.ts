import { NextResponse, type NextRequest } from "next/server";
import { checkAccess } from "@/lib/access";

// Every request passes through here first: from this Mac it goes straight on, from a tailnet device only
// for the allowed Tailscale user (lib/access.ts).
export async function proxy(request: NextRequest) {
  const result = await checkAccess(request.headers);
  if (result.ok) return NextResponse.next();
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Not allowed</title><body style="font:15px system-ui;margin:0;padding:48px 20px;background:#f6f5f1;color:#1d1c19"><main style="max-width:32rem;margin:auto"><h1 style="font-size:20px">Not allowed</h1><p>${result.reason.replace(/[<>&]/g, "")}</p></main></body>`;
  return new NextResponse(html, { status: result.status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
