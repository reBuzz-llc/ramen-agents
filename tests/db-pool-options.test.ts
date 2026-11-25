// The database pool on Vercel: the idle timeout stays at or under 10 s and the pool is never attached
// to the function (attachDatabasePool with a five-minute idle timeout billed ~300 s per request and soft-blocked the team);
// off Vercel the long-lived pool stays. The function region sits next to the database (Supabase ap-southeast-2: syd1).
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { isRead, poolErrorLine, poolOptions, VERCEL_IDLE_MAX_MS, withReadRetry } from "@/lib/db/pool-options";

describe("the pool", () => {
  it("on Vercel: idle connections close within 10 s, no keep-alive, never attached to the function", () => {
    const p = poolOptions({ VERCEL: "1" });
    expect(VERCEL_IDLE_MAX_MS).toBeLessThanOrEqual(10_000);
    expect(p.idleTimeoutMillis).toBeLessThanOrEqual(VERCEL_IDLE_MAX_MS);
    expect(p.attachToVercel).toBe(false);
    expect(p.keepAlive).toBe(false);
  });

  it("off Vercel (Peek on the Mac): kept alive with a probe after 10 s idle, idle connections closed after a minute", () => {
    const p = poolOptions({});
    expect(p.idleTimeoutMillis).toBe(60_000);
    expect(p.keepAlive).toBe(true);
    expect(p.keepAliveInitialDelayMillis).toBe(10_000);
    expect(poolOptions({ VERCEL: "1" }).keepAliveInitialDelayMillis).toBe(0);
  });

  it("an idle connection's error is one timed line, without the connection's settings", () => {
    const line = poolErrorLine(Object.assign(new Error("read ETIMEDOUT"), { code: "ETIMEDOUT", client: { host: "pooler.example" } }), new Date("2026-11-18T03:57:00Z"));
    expect(line).toBe("2026-11-18T03:57:00.000Z peek db pool: idle connection error ETIMEDOUT read ETIMEDOUT");
  });

  it("a read is retried once on ETIMEDOUT or ECONNRESET; a write, another error or a second failure is not", async () => {
    const fail = (code: string) => Object.assign(new Error(code), { code });
    const run = async (q: unknown, errs: (Error | null)[]) => {
      let calls = 0;
      const query = withReadRetry(async () => {
        const e = errs[calls++];
        if (e) throw e;
        return { rows: [] };
      }, () => {});
      const out = await query(q).then(() => "ok", (e: Error) => e.message);
      return { out, calls };
    };
    expect(await run({ text: "select 1" }, [fail("ETIMEDOUT"), null])).toEqual({ out: "ok", calls: 2 });
    expect(await run("SELECT * from leads", [fail("ECONNRESET"), null])).toEqual({ out: "ok", calls: 2 });
    expect(await run({ text: "update api_keys set last_used_at = $1" }, [fail("ETIMEDOUT"), null])).toEqual({ out: "ETIMEDOUT", calls: 1 });
    expect(await run({ text: "insert into x values (1)" }, [fail("ECONNRESET")])).toEqual({ out: "ECONNRESET", calls: 1 });
    expect(await run({ text: "select 1" }, [fail("23505"), null])).toEqual({ out: "23505", calls: 1 });
    expect(await run({ text: "select 1" }, [fail("ETIMEDOUT"), fail("ETIMEDOUT")])).toEqual({ out: "ETIMEDOUT", calls: 2 });
    expect(isRead("  with x as (delete from y) select 1")).toBe(false);
  });

  it("is what lib/db opens", () => {
    const src = readFileSync(path.join(__dirname, "..", "lib", "db", "index.ts"), "utf8");
    expect(src).toMatch(/poolOptions\(process\.env\)/);
    expect(src).not.toMatch(/idleTimeoutMillis: 5 \* 60_000/); // the old hard-coded five minutes
  });

  // the hosted copy's settings: a checkout without vercel.json (one that runs Peek on its own computer) has none to check
  const VERCEL = path.join(__dirname, "..", "vercel.json");
  it.skipIf(!existsSync(VERCEL))("the functions run next to the database", () => {
    const vercel = JSON.parse(readFileSync(VERCEL, "utf8")) as { regions: string[] };
    expect(vercel.regions).toEqual(["syd1"]);
  });

  it.skipIf(!existsSync(VERCEL))("leaves migrations and the daily sweep to the Mac", () => {
    const vercel = JSON.parse(readFileSync(VERCEL, "utf8")) as { buildCommand: string; crons?: unknown };
    expect(vercel.buildCommand).toBe("npm run build");
    expect(vercel.crons).toBeUndefined();
  });
});
