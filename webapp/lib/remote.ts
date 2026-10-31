// Server-side only: remote access status for Settings > Remote access. Read-only: Tailscale's state and
// serve config, and who the dashboard lets in (lib/access.ts). Turning Tailscale on needs its app.
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const CLI = "/Applications/Tailscale.app/Contents/MacOS/Tailscale";

type RemoteStatus = {
  installed: boolean;
  state: "running" | "stopped" | "needs-login" | "not-installed" | "unknown";
  dnsName: string | null;
  owner: string | null;
  url: string | null;
  forwarding: string | null;
  allowed: string[];
  version: string | null;
};

async function cli(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await run(CLI, args, { timeout: 5000, env: { ...process.env, TAILSCALE_BE_CLI: "1" } });
    return stdout;
  } catch (err) {
    return (err as { stdout?: string }).stdout || null;
  }
}

export async function remoteStatus(): Promise<RemoteStatus> {
  const envAllowed = (process.env.DASHBOARD_ALLOWED_USERS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const empty: RemoteStatus = { installed: false, state: "not-installed", dnsName: null, owner: null, url: null, forwarding: null, allowed: envAllowed, version: null };
  try {
    await access(CLI);
  } catch {
    return empty;
  }
  const [statusJson, serveJson, version] = await Promise.all([cli(["status", "--json"]), cli(["serve", "status", "--json"]), cli(["version"])]);
  let state: RemoteStatus["state"] = "unknown";
  let dnsName: string | null = null;
  let owner: string | null = null;
  try {
    const s = JSON.parse(statusJson ?? "{}") as { BackendState?: string; Self?: { DNSName?: string; UserID?: number }; User?: Record<string, { LoginName?: string }> };
    state = s.BackendState === "Running" ? "running" : s.BackendState === "Stopped" ? "stopped" : s.BackendState === "NeedsLogin" ? "needs-login" : "unknown";
    dnsName = s.Self?.DNSName?.replace(/\.$/, "") || null;
    owner = s.Self?.UserID !== undefined ? (s.User?.[String(s.Self.UserID)]?.LoginName ?? null) : null;
  } catch {
    /* unreadable */
  }
  let forwarding: string | null = null;
  let url: string | null = null;
  try {
    const serve = JSON.parse(serveJson ?? "{}") as { Web?: Record<string, { Handlers?: Record<string, { Proxy?: string }> }>; TCP?: Record<string, { HTTPS?: boolean; HTTP?: boolean }> };
    const [host, web] = Object.entries(serve.Web ?? {})[0] ?? [];
    if (host && web) {
      const proxy = web.Handlers?.["/"]?.Proxy ?? null;
      const port = host.split(":").pop();
      const https = serve.TCP?.[port ?? ""]?.HTTPS;
      url = `${https ? "https" : "http"}://${host.replace(/:(80|443)$/, "")}/`;
      forwarding = proxy;
    }
  } catch {
    /* no serve config */
  }
  return { installed: true, state, dnsName, owner, url, forwarding, allowed: envAllowed.length ? envAllowed : owner ? [owner] : [], version: version?.split("\n")[0]?.trim() ?? null };
}
