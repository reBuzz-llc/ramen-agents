// The sign-in page's shape (the team signs in with Google too): Google only, Peek's own;
// Neon Auth's form is gone. A source check, so a later edit cannot bring back an
// email form or self sign-up unnoticed.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(path.join(process.cwd(), "app/sign-in/page.tsx"), "utf8");

describe("the sign-in page", () => {
  it("is Google only (Peek's own): no Neon Auth, no sign-up, no password", () => {
    expect(page).toMatch(/\/api\/google-signin\/start/);
    expect(existsSync(path.join(process.cwd(), "app/sign-in/sign-in-form.tsx"))).toBe(false);
    expect(existsSync(path.join(process.cwd(), "lib/neon-auth.ts"))).toBe(false);
    for (const gone of [/signUp\b/, /signIn\.email/, /type="password"/, /emailOtp/, /Create (your )?account/, /neon/i]) expect(page).not.toMatch(gone);
  });
});
