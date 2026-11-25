// After a page audit: four routes nothing called are gone, and stay gone.
import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const app = path.join(__dirname, "..", "app");
describe("routes removed by the audit", () => {
  it("the leads' by-Notion backfill, the batch write, /v1/files and /v1/assets/company have no route file", () => {
    for (const r of ["api/leads/by-notion/[pageId]", "v1/boards/[board]/batch", "v1/files", "v1/assets/company"]) expect(existsSync(path.join(app, r, "route.ts")), r).toBe(false);
  });
  it("the tasks' by-Notion route is gone too, once the engine stopped calling it", () => {
    expect(existsSync(path.join(app, "api/tasks/by-notion/[pageId]", "route.ts"))).toBe(false);
    // a person's status change on a task: no screen called it, and nothing may set a task Done any more
    expect(existsSync(path.join(app, "api/tasks/[id]", "route.ts"))).toBe(false);
  });
  it("what the family still calls is there: sections, rows", () => {
    for (const r of ["v1/assets/[list]", "v1/boards/[board]/rows"]) expect(existsSync(path.join(app, r, "route.ts")), r).toBe(true);
  });
});
