// Google sign-in's last step: Neon Auth sends the browser back to /queue?neon_auth_session_verifier=…
// and only Neon's middleware swaps that verifier for the session cookie. Without it the session never lands and every
// Google sign-in ends on /sign-in again. This proxy runs ONLY on a request carrying the verifier (the matcher's query
// condition) and does only that swap; it guards no route: pages keep their own checks (lib/page-me.ts), and the
// machine API (/v1) and the development sign-in are untouched.
import { NextResponse, type NextRequest } from "next/server";
import { neonAuth } from "@/lib/neon-auth";

const exchange = neonAuth?.middleware({ loginUrl: "/sign-in" });

export async function proxy(request: NextRequest) {
  if (!exchange) return NextResponse.next();
  return exchange(request);
}

export const config = {
  matcher: [{ source: "/((?!api/auth|_next/static|_next/image|favicon.ico).*)", has: [{ type: "query", key: "neon_auth_session_verifier" }] }],
};
