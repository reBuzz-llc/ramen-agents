// Sign-in off (PEEK_SIGNIN=off): one local owner, only requests made on this computer straight to Peek, a server that
// must listen on this computer, and the scripts' PGlite path. With sign-in on (the default) nothing changes.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { memoryDb, type Db } from "@/lib/db";
import { tenants, users } from "@/lib/db/schema";
import { bindFromArgv, bindOk, ensureLocalOwner, hostOk, isLoopbackAddress, LOCAL_TEAM, localRequest, signInMode } from "@/lib/local-mode";
import { createTenant } from "@/lib/tenants";

const H = (o: Record<string, string>) => new Headers(o);
const LOCAL = { host: "127.0.0.1:3100", "x-forwarded-for": "127.0.0.1", "x-forwarded-host": "127.0.0.1:3100", "x-forwarded-proto": "http", "x-forwarded-port": "3100" };

describe("the switch", () => {
  it("sign-in is on unless PEEK_SIGNIN says off", () => {
    expect(signInMode({})).toBe("google");
    expect(signInMode({ PEEK_SIGNIN: "google" })).toBe("google");
    expect(signInMode({ PEEK_SIGNIN: "nonsense" })).toBe("google");
    expect(signInMode({ PEEK_SIGNIN: " OFF " })).toBe("off");
  });
});

describe("only this computer (guards 2 and 3)", () => {
  it("loopback addresses and host names", () => {
    expect(["127.0.0.1", "127.8.9.1", "::1", "[::1]", "::ffff:127.0.0.1"].every(isLoopbackAddress)).toBe(true);
    expect(["10.0.0.2", "192.168.1.5", "100.101.102.103", "8.8.8.8", "::ffff:10.0.0.1", "fe80::1", ""].some(isLoopbackAddress)).toBe(false);
    expect(["localhost:3100", "127.0.0.1:3100", "[::1]:3100", "localhost"].every(hostOk)).toBe(true);
    expect(["peek.example.com", "evil.example:3100", "192.168.1.5:3100", "localhost.evil.example", null, ""].some(hostOk)).toBe(false);
  });

  it("a direct request on this computer passes, as Next fills its forwarded-for with the socket's address", () => {
    expect(localRequest(H(LOCAL))).toEqual({ ok: true });
    expect(localRequest(H({ ...LOCAL, host: "localhost:3100", "x-forwarded-host": "localhost:3100", "x-forwarded-for": "::1" }))).toEqual({ ok: true });
  });

  it("refuses another host, a forwarded host, another computer's address, a missing address", () => {
    expect(localRequest(H({ ...LOCAL, host: "evil.example:3100" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/another host/) });
    expect(localRequest(H({ ...LOCAL, "x-forwarded-host": "peek.example.ts.net" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/forwarded for another host/) });
    expect(localRequest(H({ ...LOCAL, "x-forwarded-for": "100.101.102.103" }))).toMatchObject({ ok: false, reason: expect.stringMatching(/another computer/) });
    expect(localRequest(H({ ...LOCAL, "x-forwarded-for": "127.0.0.1, 203.0.113.9" }))).toMatchObject({ ok: false });
    const { "x-forwarded-for": _gone, ...noAddress } = LOCAL;
    void _gone;
    expect(localRequest(H(noAddress))).toMatchObject({ ok: false, reason: expect.stringMatching(/unknown/) });
  });

  it.each([["tailscale-user-login", "someone@example.com"], ["cf-connecting-ip", "203.0.113.9"], ["forwarded", "for=203.0.113.9"], ["x-real-ip", "203.0.113.9"], ["true-client-ip", "203.0.113.9"]])(
    "refuses a request a proxy or tunnel passed on (%s)",
    (k, v) => expect(localRequest(H({ ...LOCAL, [k]: v }))).toMatchObject({ ok: false, reason: expect.stringMatching(/proxy/) }),
  );
});

describe("the server listens on this computer only (guard 1)", () => {
  it("reads -H and --hostname as next start and next dev take them", () => {
    expect(bindFromArgv(["node", "next", "start", "-H", "127.0.0.1", "-p", "3100"])).toBe("127.0.0.1");
    expect(bindFromArgv(["node", "next", "start", "--hostname=localhost"])).toBe("localhost");
    expect(bindFromArgv(["node", "next", "start", "--hostname", "::1"])).toBe("::1");
    expect(bindFromArgv(["node", "next", "start", "-p", "3100"])).toBe(null);
  });

  it("only a loopback host may run with sign-in off; none given means every interface", () => {
    expect(bindOk(["next", "start", "-H", "127.0.0.1"])).toBe(true);
    expect(bindOk(["next", "start", "-H", "localhost"])).toBe(true);
    expect(bindOk(["next", "start", "-H", "::1"])).toBe(true);
    expect(bindOk(["next", "start"])).toBe(false);
    expect(bindOk(["next", "start", "-H", "0.0.0.0"])).toBe(false);
    expect(bindOk(["next", "start", "-H", "192.168.1.5"])).toBe(false);
  });

  it("the start check stops a server started with sign-in off and no loopback host, and does nothing with sign-in on", async () => {
    const { localStart } = await import("@/lib/local-start");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const exits: number[] = [];
      expect(await localStart(["next", "start", "-p", "3100"], (c) => exits.push(c), {})).toBe("on");
      expect(await localStart(["next", "start", "-p", "3100"], (c) => exits.push(c), { PEEK_SIGNIN: "off" })).toBe("stopped");
      expect(exits).toEqual([1]);
      expect(err.mock.calls[0][0]).toMatch(/-H 127\.0\.0\.1/);
    } finally {
      err.mockRestore();
    }
  });

  it("instrumentation runs the start check on the Node.js runtime only", async () => {
    const src = (await import("node:fs")).readFileSync(path.join(process.cwd(), "instrumentation.ts"), "utf8");
    expect(src).toMatch(/process\.env\.NEXT_RUNTIME === "nodejs"[\s\S]*import\("\.\/lib\/local-start"\)/);
  });
});

describe("the local owner", () => {
  it("an empty database gets My team and its owner, once; the next call finds the same person", async () => {
    const db = await memoryDb();
    const a = await ensureLocalOwner(db, {});
    const b = await ensureLocalOwner(db, {});
    expect(a).toBe(b);
    expect(await db.select({ name: tenants.name, slug: tenants.slug }).from(tenants)).toEqual([LOCAL_TEAM]);
    expect(await db.select({ email: users.email, role: users.role }).from(users)).toEqual([{ email: "owner@localhost", role: "owner" }]);
  });

  it("a database with a company keeps it: its earliest active owner is the local owner, and no company is added", async () => {
    const db = await memoryDb();
    const { owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    expect(await ensureLocalOwner(db, {})).toBe(owner.id);
    expect((await db.select().from(tenants)).length).toBe(1);
  });

  it("PEEK_OWNER_EMAIL replaces the placeholder address, ready for Google sign-in; a real address is never changed", async () => {
    const db: Db = await memoryDb();
    await ensureLocalOwner(db, {});
    await ensureLocalOwner(db, { PEEK_OWNER_EMAIL: "Me@Example.com" });
    expect((await db.select({ email: users.email }).from(users))[0].email).toBe("me@example.com");
    await ensureLocalOwner(db, { PEEK_OWNER_EMAIL: "other@example.com" });
    expect((await db.select({ email: users.email }).from(users))[0].email).toBe("me@example.com");
  });
});

describe("who is asking, with sign-in off and on", () => {
  const h = { headers: {} as Record<string, string>, token: "" };
  let current: Db;
  beforeEach(async () => {
    vi.resetModules();
    current = await memoryDb();
    vi.doMock("@/lib/db", async (orig) => ({ ...(await orig<typeof import("@/lib/db")>()), db: async () => current }));
    vi.doMock("next/headers", async (real) => ({
      ...(await real<typeof import("next/headers")>()),
      headers: async () => new Headers(h.headers),
      cookies: async () => ({ get: () => (h.token ? { value: h.token } : undefined) }),
    }));
    delete (globalThis as { __peekLocalOwner?: string }).__peekLocalOwner;
  });
  afterEach(() => {
    delete process.env.PEEK_SIGNIN;
    vi.doUnmock("next/headers");
    vi.doUnmock("@/lib/db");
  });

  it("off: a request on this computer is the local owner; one through a tunnel is nobody", async () => {
    process.env.PEEK_SIGNIN = "off";
    h.headers = LOCAL;
    const { me } = await import("@/lib/auth");
    expect(await me()).toMatchObject({ role: "owner", tenantName: "My team", email: "owner@localhost" });
    vi.resetModules();
    h.headers = { ...LOCAL, "x-forwarded-for": "100.101.102.103", "tailscale-user-login": "someone@example.com" };
    const again = await import("@/lib/auth");
    expect(await again.me()).toBe(null);
  });

  it("on (the default): no session is nobody, even on this computer; Google and the development sign-in stay as they were", async () => {
    h.headers = LOCAL;
    h.token = "";
    const { me, devLoginEnabled } = await import("@/lib/auth");
    expect(await me()).toBe(null);
    expect((await current.select().from(tenants)).length).toBe(0);
    expect(typeof devLoginEnabled()).toBe("boolean");
  });

  it("off: Google sign-in and the development sign-in are off whatever their settings", async () => {
    const env = { ...process.env };
    try {
      Object.assign(process.env, { PEEK_SIGNIN: "off", GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", TEAMS_DEV_LOGIN: "1" });
      const { googleSignIn } = await import("@/lib/google-signin");
      const { devLoginEnabled } = await import("@/lib/auth");
      expect([googleSignIn(), devLoginEnabled()]).toEqual([false, false]);
      process.env.PEEK_SIGNIN = "google";
      expect(googleSignIn()).toBe(true);
    } finally {
      process.env = env;
    }
  });
});

describe("the scripts' database client", () => {
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("PGlite: refuses while Peek answers, refuses an empty folder, else reads and writes with rowCount", async () => {
    const { openClient } = await import("../scripts/db-client.mjs");
    dir = mkdtempSync(path.join(tmpdir(), "peek-pglite-"));
    await expect(openClient({ pglite: dir, up: async () => true })).rejects.toThrow(/stop it first/);
    await expect(openClient({ pglite: dir, up: async () => false })).rejects.toThrow(/no Peek database yet/);
    const made = await memoryDb(dir);
    await ensureLocalOwner(made, {});
    await (made as unknown as { $client: { close: () => Promise<void> } }).$client.close();
    const c = (await openClient({ pglite: dir, up: async () => false })) as { query: (t: string, p?: unknown[]) => Promise<{ rows: unknown[]; rowCount: number }>; end: () => Promise<void> };
    try {
      expect((await c.query("select slug from tenants")).rows).toEqual([{ slug: "team" }]);
      expect((await c.query("update tenants set name = $1", ["Our team"])).rowCount).toBe(1);
    } finally {
      await c.end();
    }
  }, 60_000);

  it("no address and no folder is refused", async () => {
    const { openClient } = await import("../scripts/db-client.mjs");
    await expect(openClient({})).rejects.toThrow(/no database/);
  });
});
