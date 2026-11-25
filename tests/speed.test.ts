// Speed, with its cautions: reads may start beside the sign-in check but are never used
// without it, the browser's remembered pages stay honest, and the local server keeps two database connections open. Invented ids.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { poolOptions } from "@/lib/db/pool-options";
import { leadsTab } from "@/lib/lead-filters";
import { isOwnWrite, mayBeRemembered, readAgainOnReturn, REMEMBER_SECONDS } from "@/lib/page-memory";
import { hintFor, readsWith, rememberHint } from "@/lib/session-hint";

const read = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const ANN = { userId: "u-ann", tenantId: "t-acme" };
const BOB = { userId: "u-bob", tenantId: "t-acme" };
const ORIGIN = "https://peek.example";

beforeEach(() => {
  delete (globalThis as { __peekSessionHints?: unknown }).__peekSessionHints;
});

describe("reads beside the sign-in check", () => {
  it("runs the check every time, and uses the early read when the check passes for the same person", async () => {
    const check = vi.fn(async () => ANN);
    const reader = vi.fn(async (w: typeof ANN) => `rows of ${w.userId}`);
    expect(await readsWith(ANN, check, reader)).toEqual({ who: ANN, data: "rows of u-ann" });
    expect(check).toHaveBeenCalledTimes(1);
    expect(reader).toHaveBeenCalledTimes(1);
  });

  it("returns nothing after a sign-out or a removed person, whatever the hint says", async () => {
    const reader = vi.fn(async () => "private rows");
    expect(await readsWith(ANN, async () => null, reader)).toBeNull();
  });

  it("lets a refusal by redirect through, and an early read that failed does not hide it", async () => {
    const redirect = new Error("NEXT_REDIRECT");
    const check = async () => {
      throw redirect;
    };
    await expect(readsWith(ANN, check, async () => Promise.reject(new Error("read failed")))).rejects.toBe(redirect);
  });

  it("throws the early read away and reads again when the check finds someone else", async () => {
    const reader = vi.fn(async (w: typeof ANN) => `rows of ${w.userId}`);
    expect(await readsWith(ANN, async () => BOB, reader)).toEqual({ who: BOB, data: "rows of u-bob" });
    expect(reader.mock.calls.map(([w]) => w.userId)).toEqual(["u-ann", "u-bob"]);
  });

  it("with no hint, reads only after the check passed", async () => {
    const order: string[] = [];
    await readsWith(null, async () => (order.push("check"), ANN), async () => (order.push("read"), 1));
    expect(order).toEqual(["check", "read"]);
    const reader = vi.fn(async () => 1);
    expect(await readsWith(null, async () => null, reader)).toBeNull();
    expect(reader).not.toHaveBeenCalled();
  });

  it("keeps only ids under the token's hash, forgets a failed session and stays bounded", () => {
    rememberHint("secret-token", { ...ANN, email: "ann@acme.example" } as typeof ANN);
    expect(hintFor("secret-token")).toEqual(ANN);
    const kept = (globalThis as unknown as { __peekSessionHints: Map<string, unknown> }).__peekSessionHints;
    expect([...kept.keys()].join()).not.toContain("secret-token");
    expect(JSON.stringify([...kept.values()])).not.toContain("ann@");
    rememberHint("secret-token", null);
    expect(hintFor("secret-token")).toBeNull();
    for (let i = 0; i < 520; i++) rememberHint(`t${i}`, ANN);
    expect(kept.size).toBe(500);
    expect(hintFor(undefined)).toBeNull();
  });

  it("the login itself is still read from the database on every request", () => {
    const auth = read("lib/auth.ts");
    expect(auth).toMatch(/const who = await sessionUser\(await getDb\(\), token\)/);
    expect(read("lib/guard.ts")).toMatch(/const who = await me\(\)/);
  });
});

describe("the browser's remembered pages", () => {
  it("uses one number for the memory and the check", () => {
    expect(read("next.config.ts")).toMatch(/staleTimes: \{ dynamic: REMEMBER_SECONDS \}/);
    expect(REMEMBER_SECONDS).toBe(30);
  });

  it("knows a save to Peek's API from everything else", () => {
    expect(isOwnWrite("/api/leads/1", { method: "PATCH" }, ORIGIN)).toBe(true);
    expect(isOwnWrite(`${ORIGIN}/api/clock`, { method: "post" }, ORIGIN)).toBe(true);
    expect(isOwnWrite(new Request(`${ORIGIN}/api/x`, { method: "DELETE" }), undefined, ORIGIN)).toBe(true);
    expect(isOwnWrite("/api/leads/1", undefined, ORIGIN)).toBe(false);
    expect(isOwnWrite("/api/leads/rows", { method: "GET" }, ORIGIN)).toBe(false);
    expect(isOwnWrite("https://other.example/api/x", { method: "POST" }, ORIGIN)).toBe(false);
    expect(isOwnWrite("/v1/leads", { method: "POST" }, ORIGIN)).toBe(false);
  });

  it("reads a page again when it may be the remembered copy", () => {
    const now = 1_000_000;
    expect(mayBeRemembered(undefined, now)).toBe(false);
    expect(mayBeRemembered(now - 29_999, now)).toBe(true);
    expect(mayBeRemembered(now - 30_000, now)).toBe(false);
  });

  it("reads again only the pages with send and reply marks", () => {
    const now = 1_000_000;
    for (const p of ["/", "/leads"]) expect(readAgainOnReturn(p, now - 1000, now)).toBe(true);
    for (const p of ["/packages", "/asset", "/samples"]) expect(readAgainOnReturn(p, now - 1000, now)).toBe(false);
    expect(readAgainOnReturn("/leads", now - 30_000, now)).toBe(false);
    expect(readAgainOnReturn("/leads", undefined, now)).toBe(false);
  });

  it("is on for signed-in people only", () => {
    expect(read("app/layout.tsx")).toContain("{who ? <FreshPages /> : null}");
  });
});

describe("connections and tabs", () => {
  it("keeps two connections open on the Mac and none on Vercel", () => {
    expect(poolOptions({}).min).toBe(2);
    expect(poolOptions({ VERCEL: "1" }).min).toBe(0);
  });

  it("reads a tab the same way from any address", () => {
    expect(["board", "table", "research", "send", "nope", null, undefined, ["board"]].map((v) => leadsTab(v as string))).toEqual(["board", "table", "research", "send", "send", "send", "send", "send"]);
  });

  it("keeps a click with a modifier as a normal link", () => {
    expect(read("app/leads/leads-view.tsx")).toContain("if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;");
  });
});
