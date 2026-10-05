// Who may use this dashboard. It listens on 127.0.0.1 only, so a request reaches it either from this Mac
// or through `tailscale serve`, which forwards HTTPS from your tailnet devices and adds the signed-in
// Tailscale user in `Tailscale-User-Login`.
//
// - From this Mac (no forwarding headers, loopback Host): allowed.
// - Forwarded: allowed only when the Tailscale login is in DASHBOARD_ALLOWED_USERS (comma-separated), or,
//   when that is unset, when it is the login this Mac itself is signed in with. The Host must be this Mac's
//   tailnet name (from `tailscale status`) or one listed in DASHBOARD_HOSTS.
// Anything else gets 403. A process on this Mac could forge the headers, but it could also read ~/bots.
import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const CLI_CANDIDATES = ["/Applications/Tailscale.app/Contents/MacOS/Tailscale", "/opt/homebrew/bin/tailscale", "/usr/local/bin/tailscale"];
const CACHE_MS = 60_000;
const FAILED_CACHE_MS = 5_000;

type Tailnet = { hosts: string[]; owner: string | null };
let cached: { at: number; value: Tailnet } | null = null;

export function hostnameOf(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1);
  return h.replace(/:\d+$/, "");
}

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** This Mac's tailnet DNS name and the login it is signed in with, from `tailscale status --json`. */
export async function tailnet(): Promise<Tailnet> {
  // A failed lookup (no hosts) is kept only briefly: one timeout while Tailscale reconnects must not lock the
  // phone out for a whole minute.
  if (cached && Date.now() - cached.at < (cached.value.hosts.length ? CACHE_MS : FAILED_CACHE_MS)) return cached.value;
  let value: Tailnet = { hosts: [], owner: null };
  for (const cli of CLI_CANDIDATES) {
    try {
      await access(/*turbopackIgnore: true*/ cli);
    } catch {
      continue;
    }
    try {
      // Without TAILSCALE_BE_CLI the app's binary, started from a launchd job, tries to open the GUI
      // ("The Tailscale GUI failed to start") instead of answering as the command-line tool.
      const { stdout } = await run(cli, ["status", "--json"], {
        timeout: 4000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, TAILSCALE_BE_CLI: "1" },
      });
      const s = JSON.parse(stdout) as {
        Self?: { DNSName?: string; UserID?: number };
        User?: Record<string, { LoginName?: string }>;
      };
      const dns = (s.Self?.DNSName ?? "").replace(/\.$/, "").toLowerCase();
      const owner = s.Self?.UserID !== undefined ? (s.User?.[String(s.Self.UserID)]?.LoginName ?? null) : null;
      // MagicDNS serves both the full name and the short machine name (for example my-mac-mini).
      const hosts = dns ? [dns, dns.split(".")[0]] : [];
      value = { hosts, owner: owner ? owner.toLowerCase() : null };
    } catch {
      /* not logged in or not running */
    }
    break;
  }
  cached = { at: Date.now(), value };
  return value;
}

export type Access =
  | { ok: true; via: "local" }
  | { ok: true; via: "tailscale"; user: string; host: string }
  | { ok: false; status: number; reason: string };

/** The host the browser used: tailscale serve may pass it on as X-Forwarded-Host. */
export function requestHost(headers: Headers): string {
  return (headers.get("x-forwarded-host") ?? headers.get("host") ?? "").split(",")[0].trim();
}

export async function checkAccess(headers: Headers): Promise<Access> {
  const host = hostnameOf(requestHost(headers));
  const login = (headers.get("tailscale-user-login") ?? "").trim().toLowerCase();
  // Next.js adds X-Forwarded-For/-Host itself, naming this Mac, so only a non-loopback value means another hop.
  const via = (headers.get("x-forwarded-for") ?? "")
    .split(",")
    .map((ip) => ip.trim().replace(/^::ffff:/, ""))
    .filter(Boolean);
  const remoteHop = via.some((ip) => !LOOPBACK.has(ip) && !LOOPBACK.has(`[${ip}]`));
  const forwarded = Boolean(login) || remoteHop || !LOOPBACK.has(host);

  if (!forwarded && LOOPBACK.has(host)) return { ok: true, via: "local" };

  const net = await tailnet();
  const hosts = new Set([...list(process.env.DASHBOARD_HOSTS), ...net.hosts]);
  if (!LOOPBACK.has(host) && !hosts.has(host)) {
    return { ok: false, status: 403, reason: `This dashboard does not answer to ${host || "an unnamed host"}.` };
  }
  if (!login) {
    return { ok: false, status: 403, reason: "Open the dashboard from this Mac, or from a device signed in to your tailnet through tailscale serve." };
  }
  const allowed = list(process.env.DASHBOARD_ALLOWED_USERS);
  const users = allowed.length ? allowed : net.owner ? [net.owner] : [];
  if (!users.includes(login)) {
    return { ok: false, status: 403, reason: `${login} is not allowed to use this dashboard.` };
  }
  return { ok: true, via: "tailscale", user: login, host };
}

/** Hosts a write request may name in Host and Origin: loopback, this Mac's tailnet name, DASHBOARD_HOSTS. */
export async function isAllowedHost(hostname: string): Promise<boolean> {
  if (LOOPBACK.has(hostname)) return true;
  const net = await tailnet();
  return list(process.env.DASHBOARD_HOSTS).includes(hostname) || net.hosts.includes(hostname);
}
