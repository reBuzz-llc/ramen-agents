import { describe, expect, it } from "vitest";
import type { NotionPage } from "@/lib/queue";
import { scoreboard, statementOf, type Person } from "@/lib/scoreboard";

const sel = (s: string) => ({ type: "select", select: s ? { name: s } : null });
const status = (s: string) => ({ type: "status", status: s ? { name: s } : null });
const people = (...ps: { id: string; email?: string }[]) => ({ type: "people", people: ps.map((p) => ({ id: p.id, name: "", person: { email: p.email } })) });
const date = (d: string) => ({ type: "date", date: d ? { start: d } : null });
const lead = (id: string, p: { status?: string; result?: string; resultDate?: string; sentBy?: string; edited?: string }): NotionPage => ({
  id,
  last_edited_time: p.edited ?? "2026-10-14T10:00:00Z",
  properties: { Status: sel(p.status ?? ""), Result: sel(p.result ?? ""), "Result date": date(p.resultDate ?? ""), "Sent by": people(...(p.sentBy ? [{ id: p.sentBy }] : [])) },
});
const team: Person[] = [
  { id: "u-sam", name: "Sam", email: "sam@acme.example", role: "member", notionUserId: "n-sam" },
  { id: "u-jo", name: "Jo", email: "jo@acme.example", role: "member", notionUserId: null },
];
const from = new Date("2026-10-12T00:00:00Z");

describe("this week", () => {
  it("credits a lead to its Sent by person, and a later reply or meeting to the same person", () => {
    const leads = [
      lead("a", { status: "Email Sent", sentBy: "n-sam" }),
      lead("b", { status: "Email Sent", sentBy: "n-sam", result: "Meeting", resultDate: "2026-10-13" }),
      lead("c", { status: "Email Sent", sentBy: "n-sam", edited: "2026-10-01T10:00:00Z" }), // sent last week
    ];
    const [sam] = scoreboard(team, [], leads, [], [], from);
    expect(sam).toMatchObject({ sent: 2, replies: 1, meetings: 1, clients: 0 });
  });

  it("counts a click on 'I sent it' when the board has no Sent by yet", () => {
    const rows = scoreboard(team, [{ userId: "u-jo", pageId: "d", at: new Date("2026-10-14T09:00:00Z") }], [lead("d", { status: "Email Sent" })], [], [], from);
    expect(rows.find((r) => r.userId === "u-jo")?.sent).toBe(1);
  });

  it("counts tasks marked Done this week for each person assigned, matched by id or email", () => {
    const task = (id: string, s: string, edited: string, ...who: { id: string; email?: string }[]): NotionPage => ({
      id,
      last_edited_time: edited,
      properties: { Status: status(s), Assign: people(...who) },
    });
    const tasks = [
      task("t1", "Done", "2026-10-13T10:00:00Z", { id: "n-sam" }, { id: "n-x", email: "jo@acme.example" }),
      task("t2", "In progress", "2026-10-13T10:00:00Z", { id: "n-sam" }),
      task("t3", "Done", "2026-10-02T10:00:00Z", { id: "n-sam" }),
    ];
    const rows = scoreboard(team, [], [], tasks, [], from);
    expect(rows.map((r) => r.tasksDone)).toEqual([1, 1]);
  });
});

describe("statement", () => {
  const week = { userId: "u", name: "Sam", role: "member", sent: 10, replies: 2, meetings: 1, clients: 0, tasksDone: 0, minutes: 600 };
  it("is hours x rate + bonus x (replies + meetings + clients)", () => {
    expect(statementOf(week, { hourly: 5, outcomeBonus: 10, currency: "USD" })).toMatchObject({ hours: 10, base: 50, outcomes: 3, bonus: 30, total: 80, missing: [] });
  });
  it("computes nothing the owner has not set", () => {
    expect(statementOf(week, {})).toMatchObject({ base: null, bonus: null, total: null, missing: ["hourly rate", "outcome bonus"] });
  });
});
