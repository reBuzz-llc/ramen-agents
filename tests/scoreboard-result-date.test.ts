// A Result date has no time, and reading it as local midnight lost a result pressed inside the
// window. These cases are built from the machine's own clock, so they hold on this machine's zone, in UTC and elsewhere.
import { describe, expect, it } from "vitest";
import { resultInWindow, scoreboard, type LeadFact, type Person } from "@/lib/scoreboard";

const HOUR = 3600e3;
const utcDay = (d: Date) => d.toISOString().slice(0, 10);
const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const person: Person = { id: "u1", name: "Olu", email: "o@acme.example", role: "member" };
const lead = (over: Partial<LeadFact>): LeadFact => ({ id: "l1", emailStatus: "Email Sent", sentBy: ["Olu"], sentAt: new Date(0), result: "Meeting", resultDate: null, updatedAt: new Date(0), ...over });
const replies = (l: LeadFact, from: Date) => scoreboard([person], [], [l], [], from)[0].replies;

// A window starting at 06:00 on the machine's clock: the old reading put any date of that day before it, in every zone.
const from = new Date(2026, 10, 23, 6, 0, 0);
const monday = new Date(2026, 10, 23, 0, 0, 0);

describe("798: a result date inside the window counts at any hour and in any zone", () => {
  it("counts a result pressed an hour after the window starts", () => {
    const at = new Date(from.getTime() + HOUR);
    expect(replies(lead({ resultDate: utcDay(at), resultSetAt: at }), from)).toBe(1);
  });

  it("counts a result pressed early in the first day of a week", () => {
    const at = new Date(monday.getTime() + 3 * HOUR);
    expect(replies(lead({ resultDate: utcDay(at), resultSetAt: at }), monday)).toBe(1);
  });

  it("leaves out a result pressed an hour before the week, though its UTC day may be the week's", () => {
    const at = new Date(monday.getTime() - HOUR);
    expect(replies(lead({ resultDate: utcDay(at), resultSetAt: at }), monday)).toBe(0);
  });

  it("reads a date someone moved as that calendar day, not as the moment they moved it", () => {
    const pressed = new Date(monday.getTime() + 30 * HOUR);
    const earlier = new Date(2026, 10, 19, 12);
    expect(replies(lead({ resultDate: localDay(earlier), resultSetAt: pressed }), monday)).toBe(0);
    expect(replies(lead({ resultDate: localDay(new Date(2026, 10, 25, 12)), resultSetAt: new Date(monday.getTime() - 72 * HOUR) }), monday)).toBe(1);
  });

  it("reads an imported date with no history as a calendar day", () => {
    expect(resultInWindow({ resultDate: localDay(monday), resultSetAt: null, updatedAt: new Date(0) }, monday)).toBe(true);
    expect(resultInWindow({ resultDate: localDay(new Date(2026, 10, 22, 12)), resultSetAt: null, updatedAt: new Date(0) }, monday)).toBe(false);
  });

  it("falls back to the last change when a lead has no date", () => {
    expect(resultInWindow({ resultDate: null, updatedAt: new Date(monday.getTime() + HOUR) }, monday)).toBe(true);
    expect(resultInWindow({ resultDate: null, updatedAt: new Date(monday.getTime() - HOUR) }, monday)).toBe(false);
  });

  it("counts an imported sent row by its date the same way", () => {
    const row = (d: Date) => lead({ sentAt: null, result: null, resultDate: localDay(d) });
    expect(scoreboard([person], [], [row(monday)], [], monday)[0].sent).toBe(1);
    expect(scoreboard([person], [], [row(new Date(2026, 10, 22, 12))], [], monday)[0].sent).toBe(0);
  });
});
