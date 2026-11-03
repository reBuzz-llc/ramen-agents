import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/same-origin";
import { TEXT_COOKIE, textOf, THEME_COOKIE, themeOf } from "@/lib/appearance";

// Settings > Appearance's form: the choice goes into this browser's cookies for a year, and back to the page.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await req.formData();
  const res = NextResponse.redirect(new URL(`/settings/appearance?msg=${encodeURIComponent("Saved for this browser.")}`, req.url), 303);
  const opts = { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" as const, httpOnly: false };
  res.cookies.set(THEME_COOKIE, themeOf(String(form.get("theme") ?? "")), opts);
  res.cookies.set(TEXT_COOKIE, textOf(String(form.get("text") ?? "")), opts);
  return res;
}
