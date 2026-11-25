// In a lead, the Attachments section sits directly under the draft email.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { splitAtDraft } from "@/lib/lead-workflow";

describe("Attachments under the draft email", () => {
  it("splits the fields just after the draft, keeping their order", () => {
    expect(splitAtDraft(["contact_person", "draft_email", "draft_whatsapp", "notes"])).toEqual({ upTo: ["contact_person", "draft_email"], rest: ["draft_whatsapp", "notes"] });
    expect(splitAtDraft(["draft_email"])).toEqual({ upTo: ["draft_email"], rest: [] });
  });

  it("with no draft showing there is nothing to sit under", () => {
    expect(splitAtDraft(["contact_person", "notes"])).toBeNull();
  });

  it("the drawer places it after the fields up to the draft, and before the rest", () => {
    const src = readFileSync(`${process.cwd()}/app/leads/leads-view.tsx`, "utf8");
    const upTo = src.indexOf("(split?.upTo ?? keys).map(cell)");
    const under = src.indexOf("{split ? attachments : null}");
    const rest = src.indexOf("split.rest.map(cell)");
    expect(upTo).toBeGreaterThan(-1);
    expect(under).toBeGreaterThan(upTo);
    expect(rest).toBeGreaterThan(under);
  });
});
