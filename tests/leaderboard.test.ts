import { describe, expect, it } from "vitest";
import { DEFAULT_WEIGHTS, standings, weightsOf } from "@/lib/leaderboard";
import type { PersonWeek } from "@/lib/scoreboard";

const p = (name: string, o: Partial<PersonWeek> = {}): PersonWeek => ({ userId: name, name, role: "member", sent: 0, replies: 0, meetings: 0, clients: 0, tasksDone: 0, minutes: 0, ...o });

describe("the leaderboard", () => {
  it("ranks by points from outcomes, never hours; the owner is left off", () => {
    const s = standings([p("Ann", { sent: 10 }), p("Bo", { replies: 1, minutes: 5000 }), p("Cy", { clients: 1 }), p("Olu", { role: "owner", clients: 9 })], DEFAULT_WEIGHTS);
    expect(s.map((r) => [r.name, r.points, r.rank])).toEqual([
      ["Cy", 10, 1], // equal points share a rank; the one with a client lists first
      ["Ann", 10, 1],
      ["Bo", 3, 3], // 5,000 minutes on the clock earn nothing
    ]);
  });
  it("uses the owner's weights where set, the defaults elsewhere", () => {
    expect(weightsOf({ sent: 2 })).toEqual({ ...DEFAULT_WEIGHTS, sent: 2 });
  });
});

describe("WhatsApp sends on the board", () => {
  it("earn what an email does, and read as emails · WhatsApp", async () => {
    const { pointsOf, sendsLabel } = await import("@/lib/leaderboard");
    expect(pointsOf(p("Ann", { sent: 2, whatsapp: 3 }), DEFAULT_WEIGHTS)).toBe(5 * DEFAULT_WEIGHTS.sent);
    expect(pointsOf(p("Bo", { sent: 2 }), DEFAULT_WEIGHTS)).toBe(2 * DEFAULT_WEIGHTS.sent); // a week saved before: no whatsapp
    expect(sendsLabel({ sent: 12, whatsapp: 4 })).toBe("12 emails · 4 WhatsApp");
    expect(sendsLabel({ sent: 12, whatsapp: 0 })).toBe("12");
  });
});
