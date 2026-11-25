// A page fed by an agent the team does not run says so in one line: Peek knows the team's agents from the Validator's
// latest tick report (its members list), and says nothing when there has been no report.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { missingAgent, missingLine, teamAgents } from "@/lib/agent-presence";
import { familyReports } from "@/lib/db/schema";
import { saveReport } from "@/lib/family";
import { createTenant } from "@/lib/tenants";

const tick = (names: string[]) => ({ kind: "tick" as const, today: {}, members: names.map((name) => ({ name, state: "working", line: "busy" })) });

describe("which agents a team has", () => {
  it("none known before the first tick report, so no page says anything", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const agents = await teamAgents(db, tenant.id);
    expect(agents).toBeNull();
    expect(missingAgent(agents, "Site Builder")).toBe("");
  });

  it("the latest tick report's members, any case; an older report does not count", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    await saveReport(db, tenant.id, tick(["Lead Gen", "Site Builder"]), new Date("2026-11-24T10:00:00Z"), "validator");
    await saveReport(db, tenant.id, tick(["Lead Gen", "Validator"]), new Date("2026-11-24T11:00:00Z"), "validator");
    const agents = await teamAgents(db, tenant.id);
    expect([...agents!].sort()).toEqual(["lead gen", "validator"]);
    expect([missingAgent(agents, "Site Builder"), missingAgent(agents, "lead gen")]).toEqual(["Site Builder", ""]);
  });

  it.each([
    ["an empty members list", { kind: "tick", today: {}, members: [] }],
    ["no members list", { kind: "tick", today: {} }],
    ["members with no names", { kind: "tick", today: {}, members: [{ state: "working" }, { name: "  " }] }],
  ])("a tick report with %s tells nothing, so no page says anything", async (_what, lines) => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    await db.insert(familyReports).values({ tenantId: tenant.id, kind: "tick", lines, at: new Date("2026-11-24T12:00:00Z"), postedBy: "validator" });
    const agents = await teamAgents(db, tenant.id);
    expect(agents).toBeNull();
    expect(missingAgent(agents, "Site Builder")).toBe("");
  });

  it("the one line names what the page holds and the agent that brings it", () => {
    expect(missingLine("Sample sites", "Site Builder")).toBe("Sample sites come from the Site Builder, which is not on your team yet.");
  });

  it("the Samples page and the Follow up tab show it for their agent, and nothing else changes", () => {
    const src = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
    expect(src("app/samples/page.tsx")).toMatch(/missingAgent\(agents, "Site Builder"\)[\s\S]*data-agent-missing[\s\S]*missingLine\("Sample sites", builderMissing\)/);
    expect(src("app/api/follow-up/route.ts")).toMatch(/missing: missingAgent\(agents, "Outreach Writer"\)/);
    expect(src("app/leads/follow-up-view.tsx")).toMatch(/data\?\.missing \? \([\s\S]*missingLine\("Follow-up drafts", data\.missing\)/);
    expect(src("app/leads/follow-up-view.tsx")).toMatch(/from "@\/lib\/agent-presence-text"/);
  });
});
