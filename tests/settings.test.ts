// Settings as a section: the pages per role, /settings's redirect, where a form comes back to, the
// API keys page's mint and revoke, and Appearance's attributes on <html>.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GET as settingsGet } from "@/app/settings/route";
import { defaultScopes, keyFor, listKeys, replaceKey, revokeKey } from "@/lib/api-keys";
import { htmlAttrs } from "@/lib/appearance";
import { memoryDb } from "@/lib/db";
import { sectionOf, SETTINGS, settingsFor, settingsTitle } from "@/lib/settings-nav";
import { createTenant } from "@/lib/tenants";

const src = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

describe("the Settings section", () => {
  it("one page per kind, in nav order; Board and API keys only for the owner", () => {
    expect(SETTINGS.map((p) => p.slug)).toEqual(["company", "people", "board", "rates", "keys", "my-view", "appearance"]);
    expect(settingsFor("owner").map((p) => p.slug)).toEqual(["company", "people", "board", "rates", "keys", "my-view", "appearance"]);
    expect(settingsFor("manager").map((p) => p.slug)).toEqual(["company", "people", "rates", "my-view", "appearance"]);
    expect(settingsFor("member").map((p) => p.slug)).toEqual(["company", "people", "rates", "my-view", "appearance"]);
  });
  it("every page exists, has the section head and its own tab title", () => {
    for (const p of SETTINGS) {
      const f = `app/settings/${p.slug}/page.tsx`;
      expect(existsSync(f), f).toBe(true);
      expect(src(f)).toContain(`settingsTitle("${p.slug}")`);
      expect(src(f)).toContain(`<SectionHead slug="${p.slug}"`);
      expect(src(f)).toContain(`pageMe("/settings/${p.slug}")`);
    }
    expect(settingsTitle("keys")).toBe("API keys · Settings · ramen-agents");
  });
  it("the owner-only pages refuse other roles", () => {
    expect(src("app/settings/board/page.tsx")).toMatch(/if \(!can\(who\.role, "settings\.notion"\)\) notFound\(\)/);
    expect(src("app/settings/keys/page.tsx")).toMatch(/if \(!can\(who\.role, "keys\.manage"\)\) notFound\(\)/);
  });
  it("/settings redirects to the first page with a real redirect, keeping a message", () => {
    const r = settingsGet(new Request("http://peek.test/settings"));
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("http://peek.test/settings/company");
    const m = settingsGet(new Request("http://peek.test/settings?msg=Role%20changed."));
    expect(m.headers.get("location")).toBe("http://peek.test/settings/company?msg=Role+changed.");
    expect(existsSync("app/settings/page.tsx")).toBe(false);
  });
  it("a form comes back to the page its action lives on", () => {
    expect(["notion", "notionDisconnect", "rates", "points", "role", "memberRate", "updates", "keyResults"].map(sectionOf)).toEqual(["board", "board", "rates", "rates", "people", "people", "company", "company"]);
    expect(src("app/api/settings/route.ts")).toContain("`/settings/${sectionOf(action)}`");
  });
  it("the nav marks the page you are on, and the left nav shows from 1024 px", () => {
    const nav = src("app/settings/settings-nav.tsx");
    expect(nav).toMatch(/aria-current=\{on\(p\.slug\) \? "page" : undefined\}/);
    expect(nav).toMatch(/hidden lg:block/);
    expect(nav).toMatch(/lg:hidden/);
  });
});

describe("API keys from Settings", () => {
  it("a name starts with the scripts' scopes", () => {
    expect([defaultScopes("dashboard"), defaultScopes("validator"), defaultScopes("engine")]).toEqual([["board:read"], ["board:read", "board:write", "board:validate"], ["board:read", "board:write"]]);
  });
  it("making a key for a name revokes its earlier one; revoke works on the company's own keys only", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "O" });
    const other = await createTenant(db, "Bravo", "bravo", { email: "o@bravo.example", name: "B" });
    const first = await replaceKey(db, tenant.id, "engine", ["board:read", "board:write"]);
    expect(first.revoked).toBe(0);
    const second = await replaceKey(db, tenant.id, "engine", ["board:read"]);
    expect(second.revoked).toBe(1);
    expect(await keyFor(db, `Bearer ${first.token}`)).toBeNull();
    expect(await keyFor(db, `Bearer ${second.token}`)).toMatchObject({ name: "engine", scopes: ["board:read"] });
    const list = await listKeys(db, tenant.id);
    expect(list.map((k) => [k.name, !!k.revokedAt])).toEqual([
      ["engine", false],
      ["engine", true],
    ]);
    expect(JSON.stringify(list)).not.toContain(second.token);
    expect(await revokeKey(db, other.tenant.id, second.id)).toBe(false);
    expect(await keyFor(db, `Bearer ${second.token}`)).not.toBeNull();
    expect(await revokeKey(db, tenant.id, second.id)).toBe(true);
    expect(await revokeKey(db, tenant.id, second.id)).toBe(false);
    expect(await keyFor(db, `Bearer ${second.token}`)).toBeNull();
  });
  it("the routes are the owner's, same-origin only", () => {
    for (const f of ["app/api/keys/route.ts", "app/api/keys/[id]/route.ts"]) {
      expect(src(f)).toContain('guard("keys.manage")');
      expect(src(f)).toContain("sameOrigin(req)");
    }
  });
});

describe("Appearance", () => {
  it("puts the chosen theme and text size on <html>, nothing for the defaults or junk", () => {
    expect(htmlAttrs(undefined, undefined)).toEqual({});
    expect(htmlAttrs("system", "standard")).toEqual({});
    expect(htmlAttrs("dark", "large")).toEqual({ "data-theme": "dark", "data-text": "large" });
    expect(htmlAttrs("light", "huge")).toEqual({ "data-theme": "light" });
    expect(htmlAttrs("<x>", undefined)).toEqual({});
  });
});
