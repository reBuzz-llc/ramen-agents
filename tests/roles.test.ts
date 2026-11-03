import { describe, expect, it } from "vitest";
import { can, canSetRole } from "@/lib/roles";

describe("roles", () => {
  it("lets a member work the queue and the clock, but not see the team or settings", () => {
    expect(can("member", "queue.work")).toBe(true);
    expect(can("member", "clock.own")).toBe(true);
    expect(can("member", "week.team")).toBe(false);
    expect(can("member", "settings.rates")).toBe(false);
  });
  it("lets a manager see the team and set key results, but not rates, Notion or people", () => {
    expect(can("manager", "week.team")).toBe(true);
    expect(can("manager", "settings.keyResults")).toBe(true);
    expect(can("manager", "settings.rates")).toBe(false);
    expect(can("manager", "settings.notion")).toBe(false);
    expect(can("manager", "users.manage")).toBe(false);
  });
  it("lets only the owner change roles, never to a second owner, never their own", () => {
    const owner = { id: "o", role: "owner" as const };
    const member = { id: "m", role: "member" as const };
    expect(canSetRole(owner, member, "manager")).toBe(true);
    expect(canSetRole(owner, member, "owner")).toBe(false);
    expect(canSetRole(owner, owner, "member")).toBe(false);
    expect(canSetRole({ id: "x", role: "manager" }, member, "manager")).toBe(false);
  });
});
