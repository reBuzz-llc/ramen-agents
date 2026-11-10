// The live office's link: the portal signs as the fleet's lib/world-public.ts verifies, two hours ahead;
// https addresses only; no frame without an address or the secret.
import { describe, expect, it } from "vitest";
import { signWorldToken, worldBase, worldLink } from "@/lib/world-share";

describe("live world link", () => {
  it("signs the vector the fleet's test checks", () => {
    expect(signWorldToken("k", "Anna", 1800000000)).toBe("MTgwMDAwMDAwMC5Bbm5h.T0QtCt8HFuAQW_8i0CXQt0j0eiJjME-V6OpJ1ec-Ctw");
  });

  it("is good for two hours from now, for this person", () => {
    const secret = "x".repeat(64);
    const link = worldLink("https://mac.tail1234.ts.net", secret, "Anna  Example", Date.UTC(2026, 10, 9, 12) )!;
    expect(link.startsWith("https://mac.tail1234.ts.net/?t=")).toBe(true);
    const payload = Buffer.from(link.split("?t=")[1].split(".")[0], "base64url").toString();
    expect(payload).toBe(`${Date.UTC(2026, 10, 9, 12) / 1000 + 7200}.Anna Example`);
  });

  it("takes https origins only; no address or no secret, no frame", () => {
    expect(worldBase("https://mac.tail1234.ts.net/some/path?x=1")).toBe("https://mac.tail1234.ts.net");
    expect(worldBase("http://mac.tail1234.ts.net")).toBeNull();
    expect(worldBase("javascript:alert(1)")).toBeNull();
    expect(worldBase("")).toBeNull();
    expect(worldLink(null, "x".repeat(64), "Anna")).toBeNull();
    expect(worldLink("https://a.ts.net", undefined, "Anna")).toBeNull();
    expect(worldLink("https://a.ts.net", "short", "Anna")).toBeNull();
  });
});
