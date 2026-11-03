import { describe, expect, it } from "vitest";
import { authMessage } from "@/lib/auth-errors";

describe("sign-in messages", () => {
  it("a thrown refusal (Neon's client throws) and a returned one both get words, never nothing", () => {
    const thrown = Object.assign(new Error("Invalid email or password"), { code: "INVALID_EMAIL_OR_PASSWORD", status: 401 });
    expect(authMessage(thrown)).toMatch(/don't match an account/);
    expect(authMessage({ code: "USER_ALREADY_EXISTS", message: "User already exists" })).toMatch(/sign in instead/);
    expect(authMessage({ message: "Something odd" })).toBe("Something odd.");
    expect(authMessage({ status: 429 })).toMatch(/Too many tries/);
    expect(authMessage({ message: "Invalid origin" })).toMatch(/allowed sites/);
    expect(authMessage(new TypeError("Failed to fetch"))).toBe("Failed to fetch.");
    expect(authMessage(new TypeError(""))).toMatch(/No answer/);
    expect(authMessage(undefined)).toMatch(/refused/);
  });
});
