import { describe, expect, it } from "vitest";
import { canClockIn, day } from "@/lib/timesheet";

const at = (h: number, m = 0) => new Date(Date.UTC(2026, 9, 14, h, m));

describe("timesheet", () => {
  it("adds up shifts and lists the gaps between them", () => {
    const d = day(
      [
        { id: "1", startedAt: at(9), endedAt: at(12), note: "" },
        { id: "2", startedAt: at(13), endedAt: at(17, 30), note: "" },
      ],
      [{ fromAt: at(12), toAt: at(13), note: "lunch" }],
    );
    expect(d.workedMinutes).toBe(7 * 60 + 30);
    expect(d.gaps).toEqual([{ from: at(12), to: at(13), minutes: 60, note: "lunch" }]);
  });
  it("runs an open shift to now, and refuses a second clock-in", () => {
    const shifts = [{ id: "1", startedAt: at(9), endedAt: null, note: "" }];
    expect(day(shifts, [], at(10, 15)).workedMinutes).toBe(75);
    expect(canClockIn(shifts)).toBe(false);
  });
  it("ignores a gap shorter than 15 minutes", () => {
    const d = day([
      { id: "1", startedAt: at(9), endedAt: at(10), note: "" },
      { id: "2", startedAt: at(10, 10), endedAt: at(11), note: "" },
    ]);
    expect(d.gaps).toEqual([]);
  });
});
