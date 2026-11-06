import { NextResponse } from "next/server";
import { COOKIE, createSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { checkCode, localMode } from "@/lib/local-codes";
import { safeNext } from "@/lib/return-path";
import { sameOrigin } from "@/lib/same-origin";

// Local mode's sign-in: an email and the code the owner issued (lib/local-codes.ts). Answers 404
// unless PEEK_LOCAL_MODE=1. The session is the portal's own (the same table the development sign-in uses); the cookie is
// Secure when the request came over HTTPS (the tunnel says so in x-forwarded-proto).
export async function POST(req: Request) {
  if (!localMode()) return NextResponse.json({ error: "not in local mode" }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await req.formData();
  const next = safeNext(form.get("next"));
  const d = await db();
  const r = await checkCode(d, String(form.get("email") ?? ""), String(form.get("code") ?? ""));
  const back = (path: string) => {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
    const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
    return new URL(path, `${proto}://${host}`);
  };
  if (!r.ok) return NextResponse.redirect(back(`/sign-in?error=${encodeURIComponent(r.error)}${next ? `&next=${encodeURIComponent(next)}` : ""}`), 303);
  const { token, expiresAt } = await createSession(d, r.userId);
  const res = NextResponse.redirect(back(next ?? "/leads"), 303);
  const https = (req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "")) === "https";
  res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: https, expires: expiresAt, path: "/" });
  return res;
}
