// The team's Guide: the sections in order, an anchor each, every one ending with what the family
// sees, a hand-set date, and nothing personal in the text.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MENU } from "@/app/nav-links";

const src = readFileSync(path.join(__dirname, "..", "app", "guide", "page.tsx"), "utf8");

describe("the Guide page", () => {
  it("sits in the profile menu between This week and Settings", () => {
    const labels = MENU.map((m) => m.label);
    expect(labels.indexOf("Guide")).toBe(labels.indexOf("This week") + 1);
    expect(labels.indexOf("Settings")).toBe(labels.indexOf("Guide") + 1);
    expect(src).not.toContain("pageMe("); // open to anyone, like Privacy: the sign-in page links it
  });

  it("has the seven sections in order, each with its anchor and a 'Seen by the family as' line", () => {
    const ids = [...src.matchAll(/^\s+id: "([a-z-]+)",$/gm)].map((m) => m[1]);
    expect(ids).toEqual(["sign-in", "pick", "send", "whatsapp", "result", "fix", "tasks"]);
    expect([...src.matchAll(/^\s+seen: "/gm)]).toHaveLength(7);
    expect(src).toContain("Seen by the family as:");
    expect(src).toMatch(/id=\{s\.id\}/);
    expect(src).toMatch(/const LAST_UPDATED = "\d{4}-\d{2}-\d{2}";/);
  });

  it("names the cells and buttons the team presses, and nothing personal", () => {
    for (const name of ["Continue with Google", "Take it", "Copy draft", "Mark email sent", "Sent by", "Sent at", "False number", "Meeting booked", "Show empty fields", "I&apos;m on it", "Done when"]) expect(src).toContain(name);
    expect(src).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/); // no email address
  });
});

describe("where a new person lands, the guide is linked", () => {
  const read = (f: string) => readFileSync(path.join(__dirname, "..", f), "utf8");
  it("Send next's empty state, the sign-in page, and the Leads drawer's first-open hint", () => {
    expect(read("app/leads/leads-view.tsx")).toMatch(/Nothing to send yet[\s\S]*href="\/guide#pick"/);
    expect(read("app/sign-in/page.tsx")).toMatch(/New here\?[\s\S]*href="\/guide"/);
    const drawer = read("app/leads/leads-view.tsx");
    expect(drawer).toMatch(/href="\/guide#send"/);
    expect(drawer).toMatch(/try \{\s*if \(localStorage\.getItem\(GUIDE_HINT_KEY\)\) return;\s*localStorage\.setItem\(GUIDE_HINT_KEY/);
  });
});
