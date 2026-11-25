// Peek on one computer with sign-in off (PEEK_SIGNIN=off): a starter install beside its own agents, with no account to
// make first. Every page then belongs to one local owner, and it answers only requests made on this computer:
//   1. the server must listen on this computer only (127.0.0.1, ::1 or localhost): instrumentation.ts stops it at start
//      otherwise (bindOk);
//   2. a request must name this computer as its host, so another site's page cannot reach it through a DNS trick
//      (hostOk);
//   3. a request that passed through a proxy or a tunnel is refused: a forwarded-for address that is not this
//      computer's, or any header a proxy adds (Tailscale, Cloudflare, Forwarded, X-Real-IP). Next fills
//      X-Forwarded-For with the connecting socket's address when a request carries none, so a direct request shows
//      127.0.0.1 or ::1;
//   4. writes keep their same-origin check (lib/same-origin.ts).
// The agents' /v1 routes keep their API keys either way. Sign-in comes back with PEEK_SIGNIN=google (the default), and
// only then may Peek be reached from another device.
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "./db";
import { tenants, users } from "./db/schema";
import { createTenant } from "./tenants";

export type SignInMode = "google" | "off";

/** Sign-in is on unless the env turns it off in so many words. */
export const signInMode = (env: Record<string, string | undefined> = process.env): SignInMode => (env.PEEK_SIGNIN?.trim().toLowerCase() === "off" ? "off" : "google");

/** The company a local install starts with; the owner renames it in Settings. */
export const LOCAL_TEAM = { name: "My team", slug: "team" };
const PLACEHOLDER_EMAIL = "owner@localhost";
/** The local owner's address: PEEK_OWNER_EMAIL (set it to your Google address before turning sign-in on), else a placeholder. */
export const localOwnerEmail = (env: Record<string, string | undefined> = process.env) => env.PEEK_OWNER_EMAIL?.trim().toLowerCase() || PLACEHOLDER_EMAIL;

/** 127.0.0.0/8, ::1 and the IPv4-mapped 127 addresses: this computer. */
export function isLoopbackAddress(a: string): boolean {
  const s = a.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return s === "::1" || /^127(?:\.\d{1,3}){3}$/.test(s) || /^::ffff:127(?:\.\d{1,3}){3}$/.test(s);
}

/** A Host (or X-Forwarded-Host) value naming this computer, with or without a port. */
export function hostOk(host: string | null | undefined): boolean {
  if (!host) return false;
  const h = host.trim().toLowerCase();
  const name = h.startsWith("[") ? h.slice(0, h.indexOf("]") + 1) : h.replace(/:\d+$/, "");
  return name === "localhost" || isLoopbackAddress(name);
}

/** Headers only a proxy or a tunnel adds. */
const PROXY_HEADERS = ["forwarded", "x-real-ip", "cf-connecting-ip", "cf-ray", "true-client-ip", "x-client-ip", "fly-client-ip", "x-vercel-forwarded-for"];

/** Is this request from this computer, straight to Peek? The reason names the first check that failed. */
export function localRequest(h: Pick<Headers, "get" | "forEach">): { ok: true } | { ok: false; reason: string } {
  if (!hostOk(h.get("host"))) return { ok: false, reason: "the request names another host" };
  const fh = h.get("x-forwarded-host");
  if (fh && fh.split(",").some((v) => !hostOk(v))) return { ok: false, reason: "the request was forwarded for another host" };
  const ff = h.get("x-forwarded-for");
  if (!ff) return { ok: false, reason: "the request's address is unknown" };
  if (ff.split(",").some((v) => !isLoopbackAddress(v))) return { ok: false, reason: "the request came from another computer" };
  let proxied = "";
  h.forEach((_v, k) => {
    const key = k.toLowerCase();
    if (!proxied && (PROXY_HEADERS.includes(key) || key.startsWith("tailscale-"))) proxied = key;
  });
  if (proxied) return { ok: false, reason: `the request passed through a proxy (${proxied})` };
  return { ok: true };
}

/** The host `next start` / `next dev` was told to listen on (-H, --hostname), or null when none was given (all interfaces). */
export function bindFromArgv(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "-H" || a === "--hostname") return argv[i + 1] ?? null;
    if (a.startsWith("--hostname=")) return a.slice("--hostname=".length);
    if (a.startsWith("-H") && a.length > 2) return a.slice(2);
  }
  return null;
}

/** May Peek run with sign-in off? Only when it listens on this computer alone. */
export function bindOk(argv: string[]): boolean {
  const h = bindFromArgv(argv);
  return !!h && (h.trim().toLowerCase() === "localhost" || isLoopbackAddress(h));
}

/** The local owner's user id: the first company's earliest active owner. On an empty database it makes "My team" and
 *  its owner, under the same lock as the first Google sign-in. A placeholder address takes PEEK_OWNER_EMAIL once that is set. */
export async function ensureLocalOwner(db: Db, env: Record<string, string | undefined> = process.env): Promise<string> {
  const email = localOwnerEmail(env);
  return db.transaction(async (tx) => {
    const t = tx as unknown as Db;
    await t.execute(sql`select pg_advisory_xact_lock(7240001)`);
    const [first] = await t.select({ id: tenants.id }).from(tenants).orderBy(asc(tenants.createdAt)).limit(1);
    if (!first) {
      const { owner } = await createTenant(t, LOCAL_TEAM.name, LOCAL_TEAM.slug, { email, name: "Owner" });
      return owner.id;
    }
    const [owner] = await t
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(and(eq(users.tenantId, first.id), eq(users.role, "owner"), eq(users.active, true)))
      .orderBy(asc(users.createdAt))
      .limit(1);
    if (!owner) throw new Error("the first company has no active owner");
    if (owner.email === PLACEHOLDER_EMAIL && email !== PLACEHOLDER_EMAIL) await t.update(users).set({ email }).where(eq(users.id, owner.id));
    return owner.id;
  });
}
