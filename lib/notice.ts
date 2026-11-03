// The notice each person reads and acknowledges before using ramen-agents, versioned. It states only what this
// version of the product does; the fuller monitoring notice (window titles, screenshots) is a template in
// docs/notice-template.md for the day such a feature exists, and publishing it would mean a new version here and a new
// acknowledgment from everyone.
import { and, eq } from "drizzle-orm";
import type { Db } from "./db";
import { acknowledgments } from "./db/schema";

// v3: ramen-agents is an hour tracker like Upwork: screenshots, activity level and app/window title while clocked in, once the desktop tracker exists and the
// company turns it on. A new version asks everyone to acknowledge again.
// v4: the agents line and the email line were not true (owner): agents see the board and the weekly counts.
// v5: leads you accepted are recorded, and the team sees a leaderboard of everyone's outcome counts and points.
// v6: the project you pick at clock-in is recorded with the times.
// v7: the notes you write while clocked in ("Now doing…") are recorded, and everyone in the company can see them.
// v8: a project's "Now doing…" notes can go to that project's client as a work log (text only).
export const NOTICE_VERSION = "v8-2026-10-14";

export const NOTICE = {
  intro:
    "ramen-agents tracks your paid work hours, the way time-tracking work platforms do: when you are clocked in, what you work on, and what comes of it. Your weekly statement and pay are built from it. Here is exactly what it records, and what it never does.",
  records: [
    "Your name, work email and role in your company.",
    "The times you clock in and out, the project you pick for that time, any note you write about a gap in your day, and the notes you write while clocked in (\"Now doing…\"), which everyone in your company can see.",
    "Which leads you accepted, marked \"reviewed\" or \"sent\", and when; and what later happened to those leads on your company's board.",
  ],
  trackerStatus:
    "The desktop tracker is not released yet. Until it is, nothing runs on your computer, and only the three things above are recorded. When it arrives, your company decides whether to turn it on, and you are asked to read and acknowledge this notice again before your first tracked hour.",
  tracker: [
    "A screenshot of your screen at a random moment in each 10-minute block.",
    "Your activity level: how many keyboard and mouse events happened each minute. It counts events; it never records which keys you pressed or what you typed.",
    "The name of the app and window in front of you (for example \"Gmail - Inbox\"). A window title can include the title of the web page or document you have open.",
    "All of it only while you are clocked in. Clock out, or pause the tracker, and recording stops.",
    "You see every screenshot and activity record of yours. You can delete a screenshot; that 10-minute block is then not counted as paid time.",
  ],
  never: [
    "No keystroke contents, no typed text, no webcam, no microphone, and no list of the websites you visit.",
    "Nothing outside the time you are clocked in.",
    "It never changes anything in your company's Notion except a lead's Status, when you click.",
  ],
  who: "You see your own day, week, statement and tracked time. Your company's owner and managers see the team's, including screenshots. Everyone on the team sees the leaderboard: each person's points and counts of leads sent, replies, meetings, clients and tasks done (never hours, pay or screenshots), and who has accepted which lead. Your company's AI agents work on the same Notion board you do, so they see who sent each lead and what came of it, and a weekly count per person (leads sent, replies, meetings, clients, tasks done). Nobody outside your company sees any of it, with one exception: the notes you write while working on a client's project can be sent to that client as a work log (the note, your name and the time; never pay, hours of other projects or screenshots).",
  keep: "Your company's owner can export or delete your records. Notion tokens are stored encrypted. Before anything recorded changes, this notice changes and you are asked to acknowledge it again.",
};

export async function acknowledged(d: Db, userId: string, version = NOTICE_VERSION) {
  const [a] = await d.select().from(acknowledgments).where(and(eq(acknowledgments.userId, userId), eq(acknowledgments.noticeVersion, version)));
  return a ?? null;
}

export async function acknowledge(d: Db, tenantId: string, userId: string, version = NOTICE_VERSION) {
  await d.insert(acknowledgments).values({ tenantId, userId, noticeVersion: version }).onConflictDoNothing();
  return acknowledged(d, userId, version);
}
