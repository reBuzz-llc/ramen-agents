// Tasks done is not needed, and the owner's own account stays off the board and the leaderboard: Tasks done leaves This week; an owner account, and a person the owner switched off the team board, is on none of
// This week's lists, the leaderboard, or any total, so the totals equal the people shown; a member's numbers are unchanged.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { offBoardIds, onBoard, withOffBoard } from "@/lib/team-board";

const people = [
  { id: "o", role: "owner", name: "Sam", email: "sam@acme.example" },
  { id: "m2", role: "manager", name: "Sam", email: "sam.two@acme.example" },
  { id: "a", role: "member", name: "Asha", email: "asha@acme.example" },
  { id: "b", role: "member", name: "Bo", email: "bo@acme.example" },
];
const rows = [
  { userId: "o", sent: 29, replies: 1 },
  { userId: "m2", sent: 17, replies: 0 },
  { userId: "a", sent: 16, replies: 2 },
  { userId: "b", sent: 2, replies: 0 },
];

describe("who is on the team's board", () => {
  it("an owner account is always off; a switched-off person too; a member stays, numbers unchanged; the totals equal the rows shown", () => {
    const off = offBoardIds(people, { offTeamBoard: ["m2"] });
    expect([...off].sort()).toEqual(["m2", "o"]);
    const shown = onBoard(rows, off);
    expect(shown).toEqual([{ userId: "a", sent: 16, replies: 2 }, { userId: "b", sent: 2, replies: 0 }]);
    expect(shown.reduce((t, r) => t + r.sent, 0)).toBe(18); // was 64 with both of the owner's accounts
    // without the switch only the owner account is off
    expect(onBoard(rows, offBoardIds(people, {})).map((r) => r.userId)).toEqual(["m2", "a", "b"]);
    expect(offBoardIds(people, { offTeamBoard: "junk" }).size).toBe(1);
  });

  it("the switch's list: on and off, once each", () => {
    expect(withOffBoard(["x"], "m2", true)).toEqual(["x", "m2"]);
    expect(withOffBoard(["x", "m2"], "m2", true)).toEqual(["x", "m2"]);
    expect(withOffBoard(["x", "m2"], "m2", false)).toEqual(["x"]);
    expect(withOffBoard(undefined, "m2", false)).toEqual([]);
  });

  it("This week: no Tasks done tile, column or note; the rows, totals and both lines leave the off-board people out", () => {
    const week = readFileSync(`${process.cwd()}/app/week/page.tsx`, "utf8");
    expect(week).not.toMatch(/label: "Tasks done"|Tasks done come from|r\.tasksDone/);
    expect(week).toMatch(/const all = onBoard\(scoreboard\(/);
    // C10: the totals add the rows shown, the people the goals count; C11: both lines by user id
    expect(week).toMatch(/const total = [^\n]*rows\.reduce/);
    expect(week).toMatch(/filter\(\(\[id\]\) => !off\.has\(id\)/);
    expect(week).not.toMatch(/offNames|offBoardNames/);
    expect(week).toMatch(/target: team \? kr\.replies : undefined/);
    // emails and WhatsApp in their own columns and tiles, each against its own goal
    expect(week).toMatch(/Emails \/ goal/);
    expect(week).toMatch(/WhatsApp \/ goal/);
    expect(week).toMatch(/label: "Emails sent"/);
    expect(week).toMatch(/label: "WhatsApp sent"/);
    expect(week).not.toMatch(/Vs goal|sendsLabel/);
    const board = readFileSync(`${process.cwd()}/app/leaderboard/page.tsx`, "utf8");
    expect(board).toMatch(/standings\(onBoard\(scoreboard\(/);
    // only the owner sets the switch; never on an owner account
    const route = readFileSync(`${process.cwd()}/app/api/settings/route.ts`, "utf8");
    expect(route).toMatch(/g\.who\.role !== "owner" \|\| target\.role === "owner"/);
  });
});
