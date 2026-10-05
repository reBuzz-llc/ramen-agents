// The write endpoints (run, stop, restart, persona) only answer this app's own page. The Host must be a name
// this dashboard answers to (loopback, or this Mac's tailnet name through tailscale serve), so DNS rebinding
// cannot reach it; the Origin must be that same host, so no other site open in the browser can post here;
// and the body must be JSON, which a cross-site form cannot send without a CORS preflight.
// Who is asking is checked before this, in proxy.ts.
import { hostnameOf, isAllowedHost, requestHost } from "./access";

export async function sameOrigin(req: Request): Promise<boolean> {
  const host = requestHost(req.headers);
  if (!host || !(await isAllowedHost(hostnameOf(host)))) return false;
  const origin = (req.headers.get("origin") ?? "").replace(/\/$/, "");
  if (origin !== `http://${host}` && origin !== `https://${host}`) return false;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin") return false;
  return (req.headers.get("content-type") ?? "").startsWith("application/json");
}
