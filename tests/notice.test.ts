import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { acknowledge, acknowledged, NOTICE_VERSION } from "@/lib/notice";
import { createTenant } from "@/lib/tenants";

describe("notice acknowledgment", () => {
  it("is recorded once per version, with its time, and a new version needs a new one", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "O" });
    expect(await acknowledged(db, owner.id)).toBeNull();
    const a = await acknowledge(db, tenant.id, owner.id);
    expect(a?.noticeVersion).toBe(NOTICE_VERSION);
    expect(a?.acknowledgedAt).toBeInstanceOf(Date);
    const again = await acknowledge(db, tenant.id, owner.id); // twice keeps the first
    expect(again?.acknowledgedAt.getTime()).toBe(a?.acknowledgedAt.getTime());
    expect(await acknowledged(db, owner.id, "v2-later")).toBeNull();
  });
});
