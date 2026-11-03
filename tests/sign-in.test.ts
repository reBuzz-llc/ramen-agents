// The sign-in page's shape: Google only. A source check,
// so a later edit cannot bring back an email form or self sign-up unnoticed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const form = readFileSync(path.join(process.cwd(), "app/sign-in/sign-in-form.tsx"), "utf8");

describe("the sign-in form", () => {
  it("is Google only: no email form, no sign-up, no password reset", () => {
    expect(form).toMatch(/signIn\.social\(\{ provider: "google"/);
    for (const gone of [/signUp\b/, /signIn\.email/, /type="password"/, /type="email"/, /emailOtp/, /Create (your )?account/, /Sign in with email/]) expect(form).not.toMatch(gone);
  });
});
