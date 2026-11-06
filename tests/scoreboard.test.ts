import { describe, expect, it } from "vitest";
import {
  scoreboard,
  statementOf,
  type LeadFact,
  type Person,
  type TaskFact,
} from "@/lib/scoreboard";

const lead = (
  id: string,
  p: Partial<LeadFact> & { sentBy?: string[] } = {},
): LeadFact => ({
  id,
  notionPageId: null,
  emailStatus: null,
  sentBy: [],
  sentAt: null,
  result: null,
  resultDate: null,
  updatedAt: new Date("2026-10-14T10:00:00Z"),
  ...p,
});
const team: Person[] = [
  {
    id: "u-sam",
    name: "Sam",
    email: "sam@acme.example",
    role: "member",
    notionUserId: "n-sam",
  },
  {
    id: "u-jo",
    name: "Jo",
    email: "jo@acme.example",
    role: "member",
    notionUserId: null,
  },
];
const from = new Date("2026-10-12T00:00:00Z");
const sent = (at: string, more: Partial<LeadFact> = {}) => ({
  emailStatus: "Email Sent",
  sentAt: new Date(at),
  ...more,
});

describe("this week, from Peek's board", () => {
  it("credits a lead to its Sent by person, and a later reply or meeting to the same person", () => {
    const leads = [
      lead("a", { ...sent("2026-10-13T09:00:00Z"), sentBy: ["Sam"] }),
      lead("b", {
        ...sent("2026-10-13T09:00:00Z", {
          result: "Meeting",
          resultDate: "2026-10-13",
        }),
        sentBy: ["sam"],
      }),
      lead("c", { ...sent("2026-10-01T10:00:00Z"), sentBy: ["Sam"] }), // sent last week
    ];
    const [sam] = scoreboard(team, [], leads, [], [], from);
    expect(sam).toMatchObject({ sent: 2, replies: 1, meetings: 1, clients: 0 });
  });

  it("matches Sent by by name or email, without case", () => {
    const rows = scoreboard(
      team,
      [],
      [
        lead("a", {
          ...sent("2026-10-13T09:00:00Z"),
          sentBy: ["JO@acme.example"],
        }),
      ],
      [],
      [],
      from,
    );
    expect(rows.find((r) => r.userId === "u-jo")?.sent).toBe(1);
  });

  it("counts a click on 'I sent it' when the board has no Sent by yet, by lead id or its old Notion page id", () => {
    const clicks = [
      { userId: "u-jo", pageId: "d", at: new Date("2026-10-14T09:00:00Z") },
      {
        userId: "u-jo",
        pageId: "notion-e",
        at: new Date("2026-10-14T09:00:00Z"),
      },
    ];
    const leads = [
      lead("d", { emailStatus: "Email Sent" }),
      lead("e", { emailStatus: "Email Sent", notionPageId: "notion-e" }),
    ];
    expect(
      scoreboard(team, clicks, leads, [], [], from).find(
        (r) => r.userId === "u-jo",
      )?.sent,
    ).toBe(2);
  });

  it("dates an imported sent row without Sent at by its result date", () => {
    const leads = [
      lead("i", {
        emailStatus: "Email Sent",
        result: "Emailed",
        resultDate: "2026-10-13",
        sentBy: ["Sam"],
      }),
      lead("j", {
        emailStatus: "Email Sent",
        result: "Emailed",
        resultDate: "2026-09-01",
        sentBy: ["Sam"],
      }),
    ];
    expect(scoreboard(team, [], leads, [], [], from)[0].sent).toBe(1);
  });

  it("counts tasks Done this week once for each person assigned, by name or email", () => {
    const task = (
      status: string,
      at: string,
      ...assignees: string[]
    ): TaskFact => ({ status, assignees, updatedAt: new Date(at) });
    const tasks = [
      task("Done", "2026-10-13T10:00:00Z", "Sam", "jo@acme.example", "Sam"),
      task("In progress", "2026-10-13T10:00:00Z", "Sam"),
      task("Done", "2026-10-02T10:00:00Z", "Sam"),
    ];
    expect(
      scoreboard(team, [], [], tasks, [], from).map((r) => r.tasksDone),
    ).toEqual([1, 1]);
  });
});

describe("statement", () => {
  const week = {
    userId: "u",
    name: "Sam",
    role: "member",
    sent: 10,
    replies: 2,
    meetings: 1,
    clients: 0,
    tasksDone: 0,
    minutes: 600,
  };
  it("is hours x rate + bonus x (replies + meetings + clients)", () => {
    expect(
      statementOf(week, { hourly: 5, outcomeBonus: 10, currency: "USD" }),
    ).toMatchObject({
      hours: 10,
      base: 50,
      outcomes: 3,
      bonus: 30,
      total: 80,
      missing: [],
    });
  });
  it("computes nothing the owner has not set", () => {
    expect(statementOf(week, {})).toMatchObject({
      base: null,
      bonus: null,
      total: null,
      missing: ["hourly rate", "outcome bonus"],
    });
  });
});
