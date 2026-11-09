// The public office's server: 127.0.0.1:3200, three routes, nothing else.
//   GET /       the read-only world (dist/world-public/index.html, built by scripts/world-public-build.mjs)
//   GET /state  the masked state it polls (from the dashboard's /api/world-public, kept at most 15 s)
//   anything    404
// Both need a link signed by the team portal (?t=, then the x-world-token header or the cookie it sets): HMAC-SHA256 with the
// secret in common-data/keys/world-share.key, two hours at most; a bad or expired one gets 403. 60 requests a minute per
// address. One log line per request in common-data/logs/world-public.log (never the token). The owner exposes it with
// `tailscale funnel --bg 3200` (docs/world-public.md); the dashboard itself stays on 127.0.0.1:3000, unexposed.
//   node --experimental-strip-types scripts/world-public.ts
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
// @ts-expect-error TS5097: run by node's type stripping, which needs the extension
import { makeLimiter, routeOf, STATE_MAX_AGE_MS, verifyToken } from "../lib/world-public.ts";

const BOTS = process.env.BOTS_DIR ?? path.join(homedir(), "bots");
const COOKIE = "world_t";
export const FORBIDDEN = "This link is not valid or has expired: open the office again from the team portal.";

export type Options = {
  secret: string;
  page: () => Promise<string>;
  state: () => Promise<string>;
  log?: (line: string) => void;
  now?: () => number;
  frameAncestors?: string;
  limit?: number;
};

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** The client's address: the funnel (a local proxy) passes it in X-Forwarded-For. */
export function clientIp(req: IncomingMessage): string {
  const remote = req.socket.remoteAddress ?? "";
  const fwd = String(req.headers["x-forwarded-for"] ?? "").split(",")[0].trim();
  return LOOPBACK.has(remote) && fwd ? fwd : remote;
}

const cookieOf = (req: IncomingMessage, name: string) =>
  String(req.headers.cookie ?? "")
    .split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === name)?.[1];

export function handler(o: Options) {
  const allow = makeLimiter(o.limit);
  const now = o.now ?? (() => Date.now());
  const csp = `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src blob:; frame-ancestors ${o.frameAncestors ?? "'self'"}`;
  return async (req: IncomingMessage, res: ServerResponse) => {
    const started = now();
    const url = new URL(req.url ?? "/", "http://world.local");
    const ip = clientIp(req);
    let person = "";
    const send = (status: number, body: string | Buffer, headers: Record<string, string> = {}) => {
      res.writeHead(status, { "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", ...headers });
      res.end(req.method === "HEAD" ? undefined : body);
      o.log?.(`${new Date(started).toISOString()} ${ip} ${req.method} ${url.pathname} ${status}${person ? ` ${person}` : ""} ${now() - started}ms`);
    };
    try {
      if (!allow(ip, started)) return send(429, "Too many requests: wait a minute.", { "content-type": "text/plain; charset=utf-8", "retry-after": "60" });
      const route = routeOf(req.method ?? "GET", url.pathname);
      if (!route) return send(404, "Not found.", { "content-type": "text/plain; charset=utf-8" });
      const t = url.searchParams.get("t") ?? String(req.headers["x-world-token"] ?? "") ?? "";
      const token = t || cookieOf(req, COOKIE) || "";
      const ok = verifyToken(o.secret, token, Math.floor(started / 1000));
      if (!ok) return send(403, route === "page" ? `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Link expired</title><body style="font:15px system-ui;margin:0;padding:48px 20px"><p>${FORBIDDEN}</p></body>` : JSON.stringify({ error: FORBIDDEN }), { "content-type": route === "page" ? "text/html; charset=utf-8" : "application/json" });
      person = ok.person.split(" ")[0];
      if (route === "page") {
        const maxAge = Math.max(0, ok.exp - Math.floor(started / 1000));
        // the cookie lets a reload keep working; inside the portal's frame it is a third-party cookie, so the page also sends
        // the token itself (x-world-token) and does not depend on it
        return send(200, await o.page(), {
          "content-type": "text/html; charset=utf-8",
          "content-security-policy": csp,
          "set-cookie": `${COOKIE}=${token}; Path=/; Max-Age=${maxAge}; HttpOnly; Secure; SameSite=None; Partitioned`,
        });
      }
      let body: string;
      try {
        body = await o.state();
      } catch (err) {
        return send(503, JSON.stringify({ error: `The Mac's dashboard did not answer (${err instanceof Error ? err.message : String(err)}).` }), { "content-type": "application/json" });
      }
      const gz = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
      return send(200, gz ? gzipSync(body) : body, { "content-type": "application/json", ...(gz ? { "content-encoding": "gzip", vary: "accept-encoding" } : {}) });
    } catch (err) {
      return send(500, `Error: ${err instanceof Error ? err.message : String(err)}`, { "content-type": "text/plain; charset=utf-8" });
    }
  };
}

/** The dashboard's masked state, fetched at most every 15 s, one request at a time. */
export function stateFrom(base: string, fetcher: typeof fetch = fetch, now = () => Date.now()) {
  let cache: { at: number; body: Promise<string> } | null = null;
  return () => {
    if (!cache || now() - cache.at > STATE_MAX_AGE_MS) {
      const body = (async () => {
        const r = await fetcher(`${base}/api/world-public`, { signal: AbortSignal.timeout(20_000), cache: "no-store" });
        const text = await r.text();
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return text;
      })();
      cache = { at: now(), body };
      body.catch(() => (cache = null));
    }
    return cache.body;
  };
}

export async function start(port = Number(process.env.WORLD_PUBLIC_PORT ?? 3200)): Promise<Server> {
  const keyFile = path.join(BOTS, "common-data", "keys", "world-share.key");
  const secret = (await readFile(keyFile, "utf8").catch(() => "")).trim();
  if (secret.length < 32) throw new Error(`no secret in ${keyFile}: run sh scripts/world-share-key.sh`);
  const pageFile = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "dist", "world-public", "index.html");
  // the page is a build output (not in git): built here when missing, e.g. on a fresh checkout
  if (!(await readFile(pageFile, "utf8").catch(() => ""))) await (await import("./world-public-build.mjs")).buildWorld({ quiet: true });
  const logFile = path.join(BOTS, "common-data", "logs", "world-public.log");
  await mkdir(path.dirname(logFile), { recursive: true });
  const h = handler({
    secret,
    page: () => readFile(pageFile, "utf8"),
    state: stateFrom(process.env.DASHBOARD_URL ?? "http://127.0.0.1:3000"),
    log: (line) => void appendFile(logFile, line + "\n").catch(() => {}),
    frameAncestors: process.env.WORLD_FRAME_ANCESTORS,
  });
  const server = createServer((req, res) => void h(req, res));
  await new Promise<void>((ok) => server.listen(port, "127.0.0.1", ok));
  console.log(`world-public on http://127.0.0.1:${port}`);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  start().catch((err) => {
    console.error(String(err instanceof Error ? err.message : err));
    process.exit(1);
  });
}
