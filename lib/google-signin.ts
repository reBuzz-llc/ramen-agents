// Google sign-in without a hosted auth service (Neon Auth, or any other), so sign-in does not depend on the database
// host. The portal runs the OAuth code flow itself, with PKCE: /api/google-signin/start sends the browser to Google
// with a state and a code challenge kept in short-lived cookies; /api/google-signin/callback swaps the code for a token,
// asks Google who it is (a verified email), and signs in the person with that email on a company here, in the portal's own
// session table (the same sessions as the codes). No account is created: an unknown email is refused (only the very
// first sign-in on an empty database makes the company, as before). The codes stay the outage path.
// Settings: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (a Google Cloud OAuth client, "Web application", with the
// redirect URI <origin>/api/google-signin/callback).
import { createHash, randomBytes } from "node:crypto";

export const STATE_COOKIE = "pp_g_state";
export const VERIFIER_COOKIE = "pp_g_verifier";
export const NEXT_COOKIE = "pp_g_next";
const AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

/** The portal's own Google sign-in is configured. */
export const googleSignIn = () => !!(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());

const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export const newState = () => b64url(randomBytes(24));
export const newVerifier = () => b64url(randomBytes(48));
export const challengeOf = (verifier: string) => b64url(createHash("sha256").update(verifier).digest());

/** The address the browser sees (behind Vercel or a tunnel: the forwarded host and protocol). */
export function originOf(req: Request): string {
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? u.host;
  const proto = req.headers.get("x-forwarded-proto") ?? u.protocol.replace(":", "");
  return `${proto}://${host}`;
}
export const redirectUri = (origin: string) => `${origin}/api/google-signin/callback`;

/** Google's consent page for this sign-in: openid, email and profile only. */
export function authUrl(origin: string, state: string, verifier: string): string {
  const q = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
    redirect_uri: redirectUri(origin),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challengeOf(verifier),
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTH}?${q}`;
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/** The code -> who it is: a verified email and a name, or why not. */
export async function googleIdentity(origin: string, code: string, verifier: string, fetchFn: Fetch = fetch): Promise<{ ok: true; email: string; name: string } | { ok: false; reason: string }> {
  const tokenRes = await fetchFn(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID?.trim() ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
      redirect_uri: redirectUri(origin),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }).toString(),
  }).catch(() => null);
  const token = (await tokenRes?.json().catch(() => null)) as { access_token?: string } | null;
  if (!tokenRes?.ok || !token?.access_token) return { ok: false, reason: "Google did not confirm the sign-in. Try again." };
  const infoRes = await fetchFn(USERINFO, { headers: { Authorization: `Bearer ${token.access_token}` } }).catch(() => null);
  const info = (await infoRes?.json().catch(() => null)) as { email?: string; email_verified?: boolean; name?: string } | null;
  if (!infoRes?.ok || !info?.email) return { ok: false, reason: "Google did not say which account this is. Try again." };
  if (info.email_verified !== true) return { ok: false, reason: "That Google account's email is not verified." };
  return { ok: true, email: info.email.trim().toLowerCase(), name: String(info.name ?? "") };
}
