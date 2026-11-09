import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { DRAWER_ORDER } from "@/lib/lead-workflow";
import { createTenant } from "@/lib/tenants";
import { DEFAULT_VIEW, drawerOrder, fieldLabel, orderFromTable, viewOf } from "@/lib/view-prefs";
import { getViewPrefs, setViewPrefs } from "@/lib/view-prefs-db";

describe("a person's drawer view", () => {
  it("reads anything stored as a tidy view: known fields only, show empty by default", () => {
    expect(viewOf(null)).toEqual(DEFAULT_VIEW);
    expect(viewOf({ show_empty: "no", field_order: ["notes", "nope", 3, "notes", "phone"], hidden_fields: ["notion_uid", "business"] })).toEqual({ show_empty: true, field_order: ["notes", "phone"], hidden_fields: ["notion_uid"] });
    // the default order is kept as no order, so fields added later fall into their default place
    expect(viewOf({ field_order: DRAWER_ORDER.slice(0, 3) }).field_order).toEqual([]);
  });
  it("puts the person's fields first, then every other field in the default order", () => {
    const o = drawerOrder({ ...DEFAULT_VIEW, field_order: ["notes", "phone"] });
    expect(o.slice(0, 2)).toEqual(["notes", "phone"]);
    expect([...o].sort()).toEqual([...DRAWER_ORDER].sort());
    expect(drawerOrder(DEFAULT_VIEW)).toEqual(DRAWER_ORDER);
  });
  it("copies the Table tab's column order, skipping the header's columns", () => {
    expect(orderFromTable(["business", "website", "leadScore", "foundBy", "updatedAt", "whatsapp", "leadScore"])).toEqual(["lead_score", "found_by", "whatsapp"]);
    expect(fieldLabel("package")).toBe("How can I help");
  });
  it("keeps it on the person, merged a part at a time, and resets", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    expect(await getViewPrefs(db, tenant.id, owner.id)).toEqual(DEFAULT_VIEW);
    await setViewPrefs(db, tenant.id, owner.id, { show_empty: false });
    await setViewPrefs(db, tenant.id, owner.id, { field_order: ["draft_email", "contact_person"], hidden_fields: ["notion_uid"] });
    expect(await getViewPrefs(db, tenant.id, owner.id)).toEqual({ show_empty: false, field_order: ["draft_email", "contact_person"], hidden_fields: ["notion_uid"] });
    await setViewPrefs(db, tenant.id, owner.id, DEFAULT_VIEW);
    expect(await getViewPrefs(db, tenant.id, owner.id)).toEqual(DEFAULT_VIEW);
  });
});
