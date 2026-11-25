import { describe, expect, it } from "vitest";
import { OFF_WORDS, offReason } from "@/lib/world-off";

describe("why the live world is off", () => {
  const me = "https://peek-host.example.test:8443";
  it("no answer from the relay: the Mac or its tunnel is down", () => {
    expect(offReason(null, me)).toBe("down");
    expect(offReason({ ok: false }, me)).toBe("down");
    expect(OFF_WORDS.down).toMatch(/tunnel is down/);
  });
  it("the relay answers but leaves this address out of its frame rule: refused", () => {
    expect(offReason({ ok: true, framers: ["https://peek.example.test"] }, me)).toBe("refused");
    expect(offReason({ ok: true }, me)).toBe("refused");
    expect(OFF_WORDS.refused).not.toMatch(/down/);
  });
  it("the relay answers and allows this address: the world itself did not start", () => {
    expect(offReason({ ok: true, framers: ["https://peek.example.test", me] }, me)).toBe("quiet");
  });
});
