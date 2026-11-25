// Task done is removed. Nobody can mark a task done on Peek, so it is no target, earns no points and is on no statement.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keyResultsSet } from "@/lib/goals-nudge";
import { DEFAULT_WEIGHTS, OUTCOMES, pointsOf, weightsOf } from "@/lib/leaderboard";
import type { PersonWeek } from "@/lib/scoreboard";

const read = (p: string) => readFileSync(`${process.cwd()}/${p}`, "utf8");
// a week stored before the removal may still carry tasksDone: it scores nothing
const row = { userId: "u", name: "A", role: "member", sent: 1, replies: 0, meetings: 0, clients: 0, tasksDone: 9, minutes: 0 } as PersonWeek;

describe("Tasks done is gone", () => {
  it("earns no points, even with an old weight still saved", () => {
    expect(OUTCOMES).not.toContain("tasksDone");
    expect(pointsOf(row, DEFAULT_WEIGHTS)).toBe(1);
    expect(pointsOf(row, weightsOf({ tasksDone: 50 } as never))).toBe(1);
  });

  it("an old saved target alone does not count as a key result", () => {
    expect(keyResultsSet({ tasksDone: 6 } as never)).toBe(false);
    expect(keyResultsSet({ sent: 60 })).toBe(true);
  });

  it("no page, export or setting shows it", () => {
    for (const f of ["app/settings/company/page.tsx", "app/settings/rates/page.tsx", "app/guide/page.tsx", "app/leaderboard/page.tsx", "app/week/statement/[userId]/page.tsx", "app/api/statement/route.ts", "app/api/settings/route.ts"])
      expect(read(f)).not.toMatch(/tasksDone|Tasks done|tasks done|Task done/);
  });
});
