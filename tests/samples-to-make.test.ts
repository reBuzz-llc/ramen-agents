import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { writeLead, type Actor } from "@/lib/leads";
import { samplesToMake } from "@/lib/samples-to-make";
import { createTenant } from "@/lib/tenants";

describe("Samples to make", () => {
  it("the person's answered Starter Website leads with no sample yet, longest waiting first", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const OLU: Actor = { kind: "person", name: "Olu", userId: owner.id };
    const make = async (business: string, f: Record<string, unknown>) => {
      const r = await writeLead(db, tenant.id, {}, { business, package: "Starter Website", map_link: "https://maps.google.com/?cid=1", pain_point: "Pain point: only a Google listing\nThey can try: …", email_status: "Email Sent", sent_by: ["Olu"], ...f }, OLU, { create: true });
      if (!r.ok) throw new Error(r.message);
      return r.lead.id;
    };
    await make("Luna Salon", { result: "Meeting", result_date: "2026-11-08" });
    await make("Park Deli", { result: "Replied", result_date: "2026-11-05" });
    await make("Done Cafe", { result: "Meeting", result_date: "2026-11-04", sample_url: "https://s.example/done" }); // has its sample
    await make("Quiet Bar", { result: "Not interested", result_date: "2026-11-04" }); // no meeting
    await make("Care Shop", { result: "Meeting", result_date: "2026-11-03", package: "Website Care Retainer" }); // another package
    await make("Ann's Lead", { result: "Meeting", result_date: "2026-11-02", sent_by: ["Ann"] }); // someone else's
    const rows = await samplesToMake(db, tenant.id, ["Olu", "o@acme.example"]);
    expect(rows.map((r) => [r.business, r.result, r.resultDate])).toEqual([
      ["Park Deli", "Replied", "2026-11-05"],
      ["Luna Salon", "Meeting", "2026-11-08"],
    ]);
    expect(rows[0]).toMatchObject({ link: "https://maps.google.com/?cid=1", painPoint: expect.stringContaining("only a Google listing") });
    expect(await samplesToMake(db, tenant.id, [])).toEqual([]);
  });
});
