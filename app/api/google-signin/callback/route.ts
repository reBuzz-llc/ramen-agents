import { NextResponse } from "next/server";
import { COOKIE, createSession } from "@/lib/session";
import { userForSignIn } from "@/lib/bootstrap";
import { db } from "@/lib/db";
import { googleIdentity, googleSignIn, NEXT_COOKIE, originOf, STATE_COOKIE, VERIFIER_COOKIE } from "@/lib/google-signin";
import { safeNext } from "@/lib/return-path";
import { markSignedIn } from "@/lib/team";

// GET /api/google-signin/callback?code&state: the state must be the one this browser was given;
// the code is swapped for Google's word on the account (a verified email); a person of a company here is signed in
// with the portal's own session, anyone else is turned back to the sign-in page with the reason. Nothing is created for an
// unknown email.
export async function GET(req: Request) {
  const origin = originOf(req);
  // the cookies from the request itself (the route's own state, verifier and next)
  const jar = new Map(
    (req.headers.get("cookie") ?? "")
      .split(";")
      .map((c) => c.trim().split("="))
      .filter((kv) => kv.length >= 2)
      .map(([k, ...v]) => [k, decodeURIComponent(v.join("="))] as const),
  );
  const back = (error: string) => {
    const res = NextResponse.redirect(new URL(`/sign-in?error=${encodeURIComponent(error)}`, origin), 303);
    for (const c of [STATE_COOKIE, VERIFIER_COOKIE, NEXT_COOKIE]) res.cookies.set(c, "", { path: "/api/google-signin", maxAge: 0 });
    return res;
  };
  if (!googleSignIn()) return back("Google sign-in is not set up.");
  const p = new URL(req.url).searchParams;
  if (p.get("error")) return back("Google sign-in was cancelled.");
  const state = jar.get(STATE_COOKIE);
  const verifier = jar.get(VERIFIER_COOKIE);
  if (!state || !verifier || p.get("state") !== state || !p.get("code")) return back("That sign-in link expired. Try again.");
  const who = await googleIdentity(origin, p.get("code")!, verifier);
  if (!who.ok) return back(who.reason);
  const d = await db();
  const r = await userForSignIn(d, who.email, who.name);
  if (!r.ok) return back(`${who.email}: ${r.reason}`);
  if (!r.user.firstSignedInAt) await markSignedIn(d, r.user.id);
  const { token, expiresAt } = await createSession(d, r.user.id);
  const res = NextResponse.redirect(new URL(safeNext(jar.get(NEXT_COOKIE)) ?? "/leads", origin), 303);
  res.cookies.set(COOKIE, token, { httpOnly: true, sameSite: "lax", secure: origin.startsWith("https://"), expires: expiresAt, path: "/" });
  for (const c of [STATE_COOKIE, VERIFIER_COOKIE, NEXT_COOKIE]) res.cookies.set(c, "", { path: "/api/google-signin", maxAge: 0 });
  return res;
}
