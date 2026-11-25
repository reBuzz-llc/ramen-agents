// The old code sign-in is removed. Peek's sign-in is Google, whatever PEEK_LOCAL_MODE still says
// on a machine, and no route takes or issues a code.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { copyText } from "@/lib/team-text";

vi.mock("@/lib/auth", () => ({ me: async () => null, devLoginEnabled: () => false }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`redirect ${to}`); } }));

const ENV = ["PEEK_LOCAL_MODE", "PEEK_OUTAGE_SIGNIN", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] as const;
const saved: Record<string, string | undefined> = {};
const has = (f: string) => existsSync(path.join(process.cwd(), f));

async function page(): Promise<string> {
  const { default: SignIn } = await import("@/app/sign-in/page");
  const el = await SignIn({ searchParams: Promise.resolve({}), params: Promise.resolve({}) } as never);
  return renderToStaticMarkup(el);
}

describe("sign-in is Google only", () => {
  beforeEach(() => {
    for (const k of ENV) saved[k] = process.env[k];
    process.env.PEEK_LOCAL_MODE = "1"; // the local start script still sets it
    process.env.PEEK_OUTAGE_SIGNIN = "1";
  });
  afterEach(() => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("shows the Google button and no code form, even with the old switches on", async () => {
    process.env.GOOGLE_CLIENT_ID = "cid.apps.example";
    process.env.GOOGLE_CLIENT_SECRET = "s";
    const html = await page();
    expect(html).toContain('href="/api/google-signin/start"');
    expect(html).not.toContain("local-sign-in");
    expect(html).not.toMatch(/name="code"|a code from the owner/);
  });

  it("says so plainly when Google is not set, and still offers no code", async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const html = await page();
    expect(html).toContain("Sign-in is not configured");
    expect(html).not.toContain("local-sign-in");
  });

  it("has no route, library or script for codes any more", () => {
    for (const f of ["app/api/local-sign-in/route.ts", "app/api/local-codes/route.ts", "lib/local-codes.ts", "lib/sign-in-kind.ts", "scripts/local-code.mjs"]) expect(has(f)).toBe(false);
    expect(readFileSync(path.join(process.cwd(), "lib/db/schema.ts"), "utf8")).not.toContain("local_codes");
  });

  it("the invite names Google only", () => {
    const text = copyText("https://peek.example", { email: "ann@acme.example", name: "Ann", ownerName: "Olu" });
    expect(text).toContain("use Continue with Google with ann@acme.example");
    expect(text).not.toMatch(/\bcode\b/);
  });
});
