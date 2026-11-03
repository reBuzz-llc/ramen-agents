import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { safeNext, withNext } from "@/lib/return-path";

const src = (f: string) => readFileSync(f, "utf8");

describe("the way back after sign-in", () => {
  it("keeps a path on this site: the deep links, with their query and hash", () => {
    for (const p of ["/tasks/c3cefafe-b2ef-41b3-aaff-80d852503982", "/leads/12eef90f-1070-42a9-95a0-d4ab8d378b8e", "/leads/import", "/files", "/queue?task=x&status=Done#tasks"]) expect(safeNext(p)).toBe(p);
  });

  it("never another host, a scheme, the sign-in steps or the API", () => {
    for (const p of ["//evil.example/x", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "evil.example", "/%0d%0aSet-Cookie:x", "/\u0000x", "/sign-in", "/sign-in?next=/files", "/welcome", "/no-access", "/api/dev-login", "", "x".repeat(600), null, 42]) {
      const got = safeNext(p);
      if (p === "/%0d%0aSet-Cookie:x") expect(got).toBe(p); // percent-encoded: a plain path on this site, never a header
      else expect(got, String(p)).toBeNull();
    }
  });

  it("rides along as ?next= only when it is safe", () => {
    expect(withNext("/sign-in", "/tasks/abc")).toBe("/sign-in?next=%2Ftasks%2Fabc");
    expect(withNext("/sign-in", "//evil.example")).toBe("/sign-in");
    expect(withNext("/welcome", undefined)).toBe("/welcome");
  });

  it("is carried by the deep links, sign-in (Google and the development form), the welcome step and its acknowledgment", () => {
    expect(src("app/tasks/[id]/route.ts")).toMatch(/pageMe\(`\/tasks\/\$\{encodeURIComponent\(id\)\}`\)/);
    expect(src("app/leads/[id]/route.ts")).toMatch(/pageMe\(`\/leads\/\$\{encodeURIComponent\(id\)\}`\)/);
    expect(src("app/leads/import/page.tsx")).toContain('pageMe("/leads/import")');
    expect(src("app/files/page.tsx")).toContain('pageMe("/files")');
    expect(src("lib/page-me.ts")).toMatch(/withNext\("\/sign-in", from\)[\s\S]*withNext\("\/welcome", from\)/);
    expect(src("app/sign-in/page.tsx")).toMatch(/const next = safeNext\(sp\.next\);[\s\S]*redirect\(next \?\? "\/queue"\)[\s\S]*<SignInForm next=\{next\} \/>[\s\S]*name="next"/);
    expect(src("app/sign-in/sign-in-form.tsx")).toContain('callbackURL: `${window.location.origin}${next ?? "/queue"}`');
    expect(src("app/api/dev-login/route.ts")).toContain('safeNext(form.get("next")) ?? "/queue"');
    expect(src("app/welcome/page.tsx")).toMatch(/name="next"/);
    expect(src("app/api/acknowledge/route.ts")).toContain("new URL(next ?? \"/\", req.url)");
  });
});
