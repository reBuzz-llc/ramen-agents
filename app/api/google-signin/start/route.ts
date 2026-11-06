import { NextResponse } from "next/server";
import { authUrl, googleSignIn, newState, newVerifier, NEXT_COOKIE, originOf, STATE_COOKIE, VERIFIER_COOKIE } from "@/lib/google-signin";
import { safeNext } from "@/lib/return-path";

// GET /api/google-signin/start?next=<path>: to Google's consent page, with a state and a PKCE verifier kept for ten
// minutes in cookies this app alone reads.
export async function GET(req: Request) {
  if (!googleSignIn()) return NextResponse.redirect(new URL("/sign-in?error=Google%20sign-in%20is%20not%20set%20up", originOf(req)), 303);
  const origin = originOf(req);
  const state = newState();
  const verifier = newVerifier();
  const next = safeNext(new URL(req.url).searchParams.get("next"));
  const res = NextResponse.redirect(authUrl(origin, state, verifier), 303);
  const opts = { httpOnly: true, sameSite: "lax" as const, secure: origin.startsWith("https://"), maxAge: 600, path: "/api/google-signin" };
  res.cookies.set(STATE_COOKIE, state, opts);
  res.cookies.set(VERIFIER_COOKIE, verifier, opts);
  if (next) res.cookies.set(NEXT_COOKIE, next, opts);
  return res;
}
