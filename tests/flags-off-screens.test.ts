// Flags are not shown on any Peek screen. The Validator keeps raising and resolving them through
// /v1, so nothing is lost and they can be shown again.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const src = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");

describe("flags on the screens", () => {
  it.each(["app/leads/leads-view.tsx", "app/leads/lead-table.tsx", "app/send-pack.tsx", "app/whatsapp-pack.tsx", "app/guide/page.tsx"])("%s shows none", (f) => {
    expect(src(f)).not.toMatch(/\bflags?\b|flagged|openFlags/i);
  });
  it("the lead's read no longer hands them to the page", () => {
    expect(src("app/api/leads/[id]/route.ts")).not.toMatch(/flags/i);
  });
  it("the Validator's own routes stay", () => {
    expect(existsSync(path.join(process.cwd(), "app/v1/rows/[id]/flags/route.ts"))).toBe(true);
    expect(existsSync(path.join(process.cwd(), "app/v1/rows/[id]/flags/[flagId]/route.ts"))).toBe(true);
  });
});
