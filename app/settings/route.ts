// /settings opens the section's first page with a real redirect (a page's redirect() would stream as a 200), keeping a
// message a form came back with.
import { NextResponse } from "next/server";
import { SETTINGS } from "@/lib/settings-nav";

export function GET(req: Request) {
  const to = new URL(`/settings/${SETTINGS[0].slug}`, req.url);
  const msg = new URL(req.url).searchParams.get("msg");
  if (msg) to.searchParams.set("msg", msg);
  return NextResponse.redirect(to, 307);
}
