// The Asset page warns before saving a section that looks like a login (never a block).
import { describe, expect, it } from "vitest";
import { LOGIN_WARNING, looksLikeLogin } from "@/lib/looks-like-login";

describe("a section that looks like a login", () => {
  it("warns on a password word, a user and secret pair, or an address / secret", () => {
    expect(looksLikeLogin("Credentials", "the shared account")).toBe(true);
    expect(looksLikeLogin("Tools", "Canva password: hunter22")).toBe(true);
    expect(looksLikeLogin("Tools", "Login details are with Anna")).toBe(true);
    expect(looksLikeLogin("Tools", "user: team@acme.example\nkey = abc123")).toBe(true);
    expect(looksLikeLogin("Hosting", "team@acme.example / Tr0ub4dor")).toBe(true);
    expect(looksLikeLogin("Passcodes", "")).toBe(true);
  });
  it("leaves an ordinary section alone", () => {
    expect(looksLikeLogin("Services", "Websites, booking pages and care plans for small businesses.")).toBe(false);
    expect(looksLikeLogin("Contact", "Write to hello@acme.example for a quote.")).toBe(false);
    expect(looksLikeLogin("Prices", "Starter Website $670 / one page")).toBe(false);
    expect(looksLikeLogin("Process", "We pass the draft to you for review.")).toBe(false);
  });
  it("says why, plainly", () => {
    expect(LOGIN_WARNING).toBe("Do not keep passwords on this page: everyone on the team can read it.");
  });
});
