// The owner's nudge to set the week's key results: owner only, gone once any key result is set.
import { describe, expect, it } from "vitest";
import { keyResultsSet, showGoalsNudge } from "../lib/goals-nudge";

describe("goals nudge", () => {
  it("shows for the owner while no key result is set", () => {
    expect(showGoalsNudge("owner", undefined)).toBe(true);
    expect(showGoalsNudge("owner", {})).toBe(true);
    expect(showGoalsNudge("owner", { sent: 0, replies: 0 })).toBe(true);
  });
  it("goes once any key result is set", () => {
    expect(keyResultsSet({ meetings: 2 })).toBe(true);
    expect(showGoalsNudge("owner", { sent: 30 })).toBe(false);
  });
  it("never shows for a manager or a member", () => {
    expect(showGoalsNudge("manager", undefined)).toBe(false);
    expect(showGoalsNudge("member", {})).toBe(false);
  });
});
