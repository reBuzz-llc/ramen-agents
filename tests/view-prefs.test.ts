import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { DRAWER_ORDER } from "@/lib/lead-workflow";
import { createTenant } from "@/lib/tenants";
import { DEFAULT_HIDDEN, DEFAULT_VIEW, drawerOrder, fieldLabel, orderFromTable, viewOf } from "@/lib/view-prefs";
import { getViewPrefs, setViewPrefs } from "@/lib/view-prefs-db";

describe("a person's drawer view", () => {
  it("reads anything stored as a tidy view: known fields only, show empty by default", () => {
    expect(viewOf(null)).toEqual(DEFAULT_VIEW);
    expect(viewOf({ show_empty: "no", field_order: ["notes", "nope", 3, "notes", "phone"], hidden_fields: ["site_health", "business"], defaults_seen: DEFAULT_HIDDEN })).toEqual({ show_empty: true, field_order: ["notes", "phone"], hidden_fields: ["site_health"], defaults_seen: DEFAULT_HIDDEN, drawer_width: null, goals_seen: null, table_columns: {} });
    // the Notion page id hidden until the person chooses; an explicit empty list shows everything
    expect(viewOf({}).hidden_fields).toContain("site_health");
    expect(viewOf({ show_empty: false }).hidden_fields).toContain("site_health");
    // a view saved before a field joined the defaults gets it hidden once; one the person unhid stays shown
    expect(viewOf({ hidden_fields: [], defaults_seen: ["site_health"] }).hidden_fields).not.toContain("site_health");
    expect(viewOf({ hidden_fields: [], defaults_seen: ["site_health"] }).hidden_fields).toContain("evidence");
    expect(viewOf({ hidden_fields: [], defaults_seen: DEFAULT_HIDDEN }).hidden_fields).toEqual([]);
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
    await setViewPrefs(db, tenant.id, owner.id, { field_order: ["draft_email", "contact_person"], hidden_fields: ["site_health"] });
    expect(await getViewPrefs(db, tenant.id, owner.id)).toMatchObject({ show_empty: false, field_order: ["draft_email", "contact_person"], hidden_fields: ["site_health"] });
    await setViewPrefs(db, tenant.id, owner.id, { hidden_fields: [] });
    expect((await getViewPrefs(db, tenant.id, owner.id)).hidden_fields).toEqual([]); // unhidden stays unhidden
    await setViewPrefs(db, tenant.id, owner.id, DEFAULT_VIEW);
    expect(await getViewPrefs(db, tenant.id, owner.id)).toEqual(DEFAULT_VIEW);
  });
});

describe("drawer width", () => {
  it("keeps a sensible saved width, drops anything else, and draws it inside the window", async () => {
    const { clampDrawer, drawerWidthOf, DRAWER_WIDTH, viewOf } = await import("@/lib/view-prefs");
    expect(viewOf({}).drawer_width).toBeNull();
    expect(viewOf({ drawer_width: 820.4 }).drawer_width).toBe(820);
    expect(viewOf({ drawer_width: 10 }).drawer_width).toBeNull();
    expect(viewOf({ drawer_width: "wide" }).drawer_width).toBeNull();
    expect(drawerWidthOf(99999)).toBeNull();
    expect(clampDrawer(null, 1440)).toBe(DRAWER_WIDTH.default);
    expect(clampDrawer(900, 1440)).toBe(900);
    expect(clampDrawer(5000, 1440)).toBe(1368); // 95 % of the window
    expect(clampDrawer(100, 1440)).toBe(DRAWER_WIDTH.min);
  });

  it("is saved with the rest of the view and cleared by null", async () => {
    const { memoryDb } = await import("@/lib/db");
    const { createTenant } = await import("@/lib/tenants");
    const { getViewPrefs, setViewPrefs } = await import("@/lib/view-prefs-db");
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    await setViewPrefs(db, tenant.id, owner.id, { show_empty: false });
    expect((await setViewPrefs(db, tenant.id, owner.id, { drawer_width: 900 })).drawer_width).toBe(900);
    const v = await getViewPrefs(db, tenant.id, owner.id);
    expect(v.drawer_width).toBe(900);
    expect(v.show_empty).toBe(false); // the rest kept
    expect((await setViewPrefs(db, tenant.id, owner.id, { drawer_width: null })).drawer_width).toBeNull();
  });
});

describe("daily-goals banner dismissed", () => {
  it("keeps the change's time a person dismissed, and nothing else", async () => {
    const { viewOf } = await import("@/lib/view-prefs");
    expect(viewOf({ goals_seen: "2026-11-09T12:00:00.000Z" }).goals_seen).toBe("2026-11-09T12:00:00.000Z");
    expect(viewOf({ goals_seen: "yesterday" }).goals_seen).toBeNull();
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    expect((await setViewPrefs(db, tenant.id, owner.id, { goals_seen: "2026-11-09T12:00:00.000Z" })).goals_seen).toBe("2026-11-09T12:00:00.000Z");
    expect((await getViewPrefs(db, tenant.id, owner.id)).goals_seen).toBe("2026-11-09T12:00:00.000Z");
  });
});
