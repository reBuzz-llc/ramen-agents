// The team's Guide: the sections in order, an anchor each, every one ending with what the family
// sees, a hand-set date, and nothing personal in the text.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MENU } from "@/app/nav-links";

const src = readFileSync(path.join(__dirname, "..", "app", "guide", "page.tsx"), "utf8");

describe("the Guide page", () => {
  it("sits in the profile menu after This week, then Family, then Settings", () => {
    const labels = MENU.map((m) => m.label);
    expect(labels.indexOf("Guide")).toBe(labels.indexOf("This week") + 1);
    // the Team page (the agents) sits between the Guide and Settings
    expect(labels.indexOf("Team")).toBe(labels.indexOf("Guide") + 1);
    expect(labels.indexOf("Settings")).toBe(labels.indexOf("Team") + 1);
    expect(src).not.toContain("pageMe("); // open to anyone, like Privacy: the sign-in page links it
  });

  it("has the seven steps in order (To-do's went with it), each with its anchor, a 'Seen by the agents as' line and a Next / Back to steps", () => {
    const ids = [...src.matchAll(/^\s+id: "([a-z-]+)",$/gm)].map((m) => m[1]);
    expect(ids).toEqual(["sign-in", "already-sent", "pick", "send", "whatsapp", "whatsapp-send", "result"]);
    expect([...src.matchAll(/^\s+seen: ["`]/gm)]).toHaveLength(7);
    expect(src).toMatch(/Next: \{steps\[i \+ 1\]\.title\}/);
    expect(src).toContain('href="#steps"');
    expect(src).toContain("Seen by the agents as:");
    expect(src).toMatch(/id=\{s\.id\}/);
    expect(src).toMatch(/const LAST_UPDATED = "\d{4}-\d{2}-\d{2}";/);
  });

  it("opens with the mission and this week, then why the team's edits matter", () => {
    expect(src.indexOf('id="mission"')).toBeLessThan(src.indexOf('id="edits"'));
    expect(src.indexOf('id="edits"')).toBeLessThan(src.indexOf('id="steps"'));
    expect(src).toContain("free one-page sample site first");
    expect(src).toMatch(/goalsOf\(who\.settings\.keyResults\)/); // the week's goals only once signed in
    expect(src).toContain("Your edits are the important data");
    expect(src).not.toMatch(/New York|NYC/); // never a place location
  });

  it("links every page a step names, and the WhatsApp step links the board filtered to verified numbers", () => {
    for (const href of ["/leads", "/leads/already-sent", "/", "/files", "/packages", "/asset", "/settings/people"]) expect(src).toContain(`<P href="${href}">`);
    expect(src).toContain('const WA_VERIFIED = "/leads?tab=board&whatsapp=WhatsApp%20Verified";');
    for (const name of ["Message sent", "WhatsApp msg sent", "Draft WhatsApp message", "Give back", "No website, has WhatsApp", "site=none"]) expect(src).toContain(name);
    expect(readFileSync(path.join(__dirname, "..", "app", "leads", "leads-view.tsx"), "utf8")).toContain('href="/guide#whatsapp-send"');
  });

  it("names the cells and buttons the team presses, and nothing personal", () => {
    for (const name of ["Continue with Google", "Take 20 numbers", "Open in WhatsApp", "Mark WhatsApp sent", "Fill my pack", "Mark already sent", "Open the lead", "Copy follow-up", "Follow-up sent", "Take it", "Copy draft", "Mark email sent", "Sent by", "Sent at", "False number", "Meeting booked", "Show empty fields", "Hide empty fields", "Use my Table column order", "Change date", "Activity", "Copy for WhatsApp", "Sample site", "Samples to make"]) expect(src).toContain(name);
    expect(src).not.toContain('href="/todo"'); // To-do is gone
    expect(src).not.toMatch(/[\w.+-]+@[\w-]+\.\w+/); // no email address
    expect(src).not.toMatch(/\bAruna\b/);
  });
});

describe("where a new person lands, the guide is linked", () => {
  const read = (f: string) => readFileSync(path.join(__dirname, "..", f), "utf8");
  it("Send next's empty state (once Our queue's), the sign-in page, and the Leads drawer's first-open hint", () => {
    expect(read("app/leads/leads-view.tsx")).toMatch(/Nothing to send yet[\s\S]*href="\/guide#pick"/);
    expect(read("app/sign-in/page.tsx")).toMatch(/New here\?[\s\S]*href="\/guide"/);
    const drawer = read("app/leads/leads-view.tsx");
    expect(drawer).toMatch(/href="\/guide#send"/);
    expect(drawer).toMatch(/try \{\s*if \(localStorage\.getItem\(GUIDE_HINT_KEY\)\) return;\s*localStorage\.setItem\(GUIDE_HINT_KEY/);
  });

  it("ends with the house standard for final sites: the design rule and the ten saleable points", () => {
    expect(src).toContain('id="site-standard"');
    expect(src).toContain("clean design with quiet, elegant motion that still reads with motion off; a slider of real food quotes with");
    expect([...src.matchAll(/^  "[^"]+",$/gm)].length).toBe(10);
    expect(src).toContain('href="#site-standard"');
  });
});

