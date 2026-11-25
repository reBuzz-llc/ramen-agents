// Behind Tailscale Funnel a hard load of /settings answered 307 to https://localhost:3100/...,
// because the redirect was built from req.url (the server's own address). Every server redirect is built from the address
// the browser used (x-forwarded-host / Host), and no Location names localhost.
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GET as settings } from "@/app/settings/route";
import { originOf } from "@/lib/google-signin";
import { publicOrigin, signInLink } from "@/lib/team-text";

const FUNNEL = "peek-host.example.ts.net:8443";
const behind = (url: string, extra: Record<string, string> = {}) =>
  new Request(url, { headers: { host: "localhost:3100", "x-forwarded-host": FUNNEL, "x-forwarded-proto": "https", ...extra } });

describe("redirects behind a proxy", () => {
  it("originOf takes the forwarded host and protocol, the first of a list", () => {
    expect(originOf(behind("http://localhost:3100/x"))).toBe(`https://${FUNNEL}`);
    expect(originOf(behind("http://localhost:3100/x", { "x-forwarded-host": `${FUNNEL}, proxy.internal` }))).toBe(`https://${FUNNEL}`);
    expect(originOf(new Request("http://localhost:3100/x", { headers: { host: "peek.example" } }))).toBe("http://peek.example");
  });

  it("/settings redirects to the forwarded address, never localhost", () => {
    for (const res of [settings(behind("https://localhost:3100/settings?msg=hi"))]) {
      const loc = res.headers.get("location") ?? "";
      expect(res.status).toBe(307);
      expect(loc.startsWith(`https://${FUNNEL}/settings/`)).toBe(true);
      expect(loc).not.toMatch(/localhost|127\.0\.0\.1/);
    }
  });

  it("no server route builds a redirect from req.url", () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const n of readdirSync(dir)) {
        const p = path.join(dir, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/route\.ts$/.test(n)) files.push(p);
      }
    };
    walk(path.join(process.cwd(), "app"));
    const bad = files.filter((f) => /redirect\([^;]*new URL\([^;]*,\s*(req\.url|url)\)/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});

describe("the address a teammate is sent", () => {
  const saved = process.env.NEXT_PUBLIC_PEEK_PUBLIC_ORIGIN;
  afterEach(() => {
    if (saved === undefined) delete process.env.NEXT_PUBLIC_PEEK_PUBLIC_ORIGIN;
    else process.env.NEXT_PUBLIC_PEEK_PUBLIC_ORIGIN = saved;
  });

  it("a localhost origin gives the configured public address while Peek runs on the Mac", () => {
    process.env.NEXT_PUBLIC_PEEK_PUBLIC_ORIGIN = `https://${FUNNEL}/`;
    expect(signInLink("http://127.0.0.1:3100")).toBe(`https://${FUNNEL}/sign-in`);
    expect(publicOrigin(`https://${FUNNEL}`)).toBe(`https://${FUNNEL}`);
  });

  it("without the setting, a Peek on one computer keeps its own address", () => {
    delete process.env.NEXT_PUBLIC_PEEK_PUBLIC_ORIGIN;
    expect(publicOrigin("http://localhost:3100")).toBe("http://localhost:3100");
  });
});
