import { describe, expect, it } from "vitest";
import { queueOf, sentSince, tasksOf, type NotionPage } from "@/lib/queue";

const t = (s: string) => ({ type: "rich_text", rich_text: s ? [{ plain_text: s }] : [] });
const sel = (s: string) => ({ type: "select", select: s ? { name: s } : null });
const num = (n: number | null) => ({ type: "number", number: n });
const row = (id: string, p: { draft?: string; status?: string; result?: string; score?: number | null; edited?: string }): NotionPage => ({
  id,
  url: `https://notion.example/${id}`,
  last_edited_time: p.edited ?? "2026-10-14T10:00:00Z",
  properties: {
    Business: { type: "title", title: [{ plain_text: `Biz ${id}` }] },
    "Draft email": t(p.draft ?? "Hi team, ..."),
    Status: sel(p.status ?? ""),
    Result: sel(p.result ?? ""),
    "Lead score": num(p.score ?? null),
  },
});

describe("my queue", () => {
  it("takes drafted rows that are not sent and have no result", () => {
    const q = queueOf([
      row("a", {}),
      row("b", { draft: "" }), // nothing to send
      row("c", { draft: "skip: the site is gone" }), // the writer's verdict, not an email
      row("d", { status: "Email Sent" }), // already sent
      row("e", { result: "Replied" }), // already answered
      row("f", { status: "WhatsApp Verified" }), // a WhatsApp check is not an email decision
      row("g", { status: "Ready to Send Email" }), // reviewed, still to send
    ]);
    expect(q.map((r) => r.pageId)).toEqual(["a", "f", "g"]);
  });

  it("puts the best lead score first, unscored last", () => {
    const q = queueOf([row("low", { score: 20 }), row("none", {}), row("high", { score: 60 })]);
    expect(q.map((r) => r.pageId)).toEqual(["high", "low", "none"]);
  });

  it("counts this week's sent rows by last edit", () => {
    const pages = [row("a", { status: "Email Sent", edited: "2026-10-13T09:00:00Z" }), row("b", { status: "Email Sent", edited: "2026-10-10T09:00:00Z" })];
    expect(sentSince(pages, "2026-10-12")).toBe(1);
  });
});

describe("our queue, by kind of task", () => {
  it("puts unapproved drafts under review and approved ones under send", () => {
    const q = queueOf([row("a", {}), row("b", { status: "Ready to Send Email" }), row("c", { status: "WhatsApp Verified" })]);
    expect(Object.fromEntries(q.map((r) => [r.pageId, r.kind]))).toEqual({ a: "review", b: "send", c: "review" });
  });
});

describe("team tasks", () => {
  const task = (id: string, p: { status?: string; priority?: string; due?: string; who?: { id: string; email?: string }[] }): NotionPage => ({
    id,
    properties: {
      Task: { type: "title", title: [{ plain_text: `Task ${id}` }] },
      Status: { type: "status", status: p.status ? { name: p.status } : null },
      Priority: sel(p.priority ?? ""),
      "Dead Line": { type: "date", date: p.due ? { start: p.due } : null },
      Assign: { type: "people", people: (p.who ?? []).map((u) => ({ id: u.id, name: u.id, person: { email: u.email } })) },
    },
  });
  it("lists open tasks, the viewer's first, then by priority and deadline", () => {
    const t = tasksOf(
      [
        task("done", { status: "Done", priority: "P0" }),
        task("dup", { status: "Dublicate" }),
        task("p2", { status: "In progress", priority: "P2" }),
        task("p0late", { status: "Not started", priority: "P0", due: "2026-10-30" }),
        task("p0soon", { status: "Not started", priority: "P0", due: "2026-10-16" }),
        task("mine", { status: "Not started", priority: "P5", who: [{ id: "u1", email: "Me@Acme.example" }] }),
      ],
      { email: "me@acme.example" },
    );
    expect(t.map((x) => x.pageId)).toEqual(["mine", "p0soon", "p0late", "p2"]);
    expect(t[0].mine).toBe(true);
  });
});
