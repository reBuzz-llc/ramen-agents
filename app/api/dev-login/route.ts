import { NextResponse } from "next/server";
import { COOKIE, createSession, devLoginEnabled } from "@/lib/auth";
import { userForSignIn } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { safeNext } from "@/lib/return-path";
import { sameOrigin } from "@/lib/same-origin";

// Development sign-in: no Google, no email. Refused in production builds and unless TEAMS_DEV_LOGIN=1.
export async function POST(req: Request) {
  if (!devLoginEnabled()) return NextResponse.json({ error: "development sign-in is off" }, { status: 404 });
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await req.formData();
  const d = await db();
  const r = await userForSignIn(d, String(form.get("email") ?? ""), String(form.get("name") ?? ""));
  if (!r.ok) return NextResponse.redirect(new URL(`/sign-in?error=${encodeURIComponent(r.reason)}`, req.url), 303);
  const { token, expiresAt } = await createSession(d, r.user.id);
  const res = NextResponse.redirect(new URL(safeNext(form.get("next")) ?? "/leads", req.url), 303);
  res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: false, expires: expiresAt, path: "/" });
  return res;
}
