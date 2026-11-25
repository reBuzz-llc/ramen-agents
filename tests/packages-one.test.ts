// One package at a time: a save sends only the changed fields of one package, refuses when someone
// saved it since, adds at the end and deletes one; the page edits one card in place.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { addPackage, checkPatch, deletePackage, listPackages, savePackages, updatePackage } from "@/lib/assets";
import { memoryDb } from "@/lib/db";
import { createTenant } from "@/lib/tenants";

const src = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const P = (name: string, price: string, email: string) => ({ name, price, offer: "", buyer: "", deliverables: [], status: "draft" as const, email, why: "", sources: [] });

describe("checkPatch", () => {
  it("keeps only the fields sent, cleaned as a full save cleans them", () => {
    expect(checkPatch({ price: "  $990  one-time " })).toEqual({ ok: true, patch: { price: "$990 one-time" } });
    expect(checkPatch({ email: "Hi,\r\n\r\n\r\nThanks  " })).toEqual({ ok: true, patch: { email: "Hi,\n\nThanks" } });
    expect(checkPatch({ deliverables: ["a", " ", "b"] })).toEqual({ ok: true, patch: { deliverables: ["a", "b"] } });
    expect(checkPatch({ name: "" })).toMatchObject({ ok: false, message: /no name/ });
    expect(checkPatch({ status: "gone" })).toMatchObject({ ok: false, message: /draft or published/ });
    expect(checkPatch({ unknown: 1 })).toMatchObject({ ok: false, message: /nothing changed/ });
  });
});

describe("one package", () => {
  it("a price edit writes the price only; a stale save is refused with who saved it; add goes last; delete removes one", async () => {
    const db = await memoryDb();
    const { tenant } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const t = tenant.id;
    await savePackages(db, t, [P("Starter Website", "$990", "Hi,\n\nThe email."), P("Care Plan", "$99/mo", "")], "Olu");
    const [a, b] = await listPackages(db, t);
    // a bot changes the email meanwhile: the person's price edit leaves it alone
    const bot = await updatePackage(db, t, a.id, { email: "Hi,\n\nThe bot's email." }, "Outreach Writer");
    expect(bot.ok).toBe(true);
    const stale = await updatePackage(db, t, a.id, { price: "$1,200" }, "Ana", a.updatedAt);
    expect(stale).toMatchObject({ ok: false, status: 409, message: /changed by Outreach Writer/ });
    const now = (await listPackages(db, t))[0];
    const r = await updatePackage(db, t, a.id, { price: "$1,200" }, "Ana", now.updatedAt);
    expect(r).toMatchObject({ ok: true, package: { price: "$1,200", email: "Hi,\n\nThe bot's email.", updatedBy: "Ana", name: "Starter Website" } });
    // the other package is untouched
    expect((await listPackages(db, t))[1]).toMatchObject({ id: b.id, updatedAt: b.updatedAt, updatedBy: "Olu" });
    expect(await updatePackage(db, t, "00000000-0000-0000-0000-000000000000", { price: "x" }, "Ana")).toMatchObject({ ok: false, status: 404 });
    const added = await addPackage(db, t, { name: "Menu Page", price: "$300" }, "Ana");
    expect(added).toMatchObject({ ok: true, package: { name: "Menu Page", position: 3, status: "draft" } });
    expect(await addPackage(db, t, { name: " " }, "Ana")).toMatchObject({ ok: false, status: 400 });
    expect(await deletePackage(db, t, b.id)).toEqual({ ok: true });
    expect((await listPackages(db, t)).map((p) => p.name)).toEqual(["Starter Website", "Menu Page"]);
    // another company's package is not found
    const other = await createTenant(db, "Other", "other", { email: "x@other.example", name: "X" });
    expect(await updatePackage(db, other.tenant.id, a.id, { price: "x" }, "X")).toMatchObject({ ok: false, status: 404 });
    expect(await deletePackage(db, other.tenant.id, a.id)).toMatchObject({ ok: false });
  });
});

describe("the page", () => {
  it("each card has its own Edit; one form at a time with Save and Cancel; the switch question, the dot, Esc and the saved line", () => {
    const v = src("app/packages/packages-view.tsx");
    expect(v).not.toMatch(/Edit packages/);
    expect(v).toMatch(/aria-label=\{`Edit \$\{p\.name\}`\}/);
    expect(v).toMatch(/open\?\.id === p\.id \?/);
    expect(v).toMatch(/Save or discard changes to \{name\}\?/);
    expect(v).toMatch(/Changed, not saved/);
    expect(v).toMatch(/e\.key !== "Escape"/);
    expect(v).toMatch(/Saved \{hhmm\(saved\[p\.id\]\.at\)\} by \{agentName\(saved\[p\.id\]\.by\)\}/);
    expect(v).toMatch(/\/api\/assets\/package\/\$\{open\.id\}`, \{ method: "PUT"/);
    expect(v).toMatch(/changedFields\(open\.base, open\.form\)/);
    // edit is for the owner and managers only
    expect(v).toMatch(/\{canEdit \? \(\s*<button[^>]*onClick=\{\(\) => go\(editOf\(p\)\)\}/);
    expect(src("app/api/assets/package/[id]/route.ts")).toMatch(/guard\("assets\.edit"\)/);
  });
});
