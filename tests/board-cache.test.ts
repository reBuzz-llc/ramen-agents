// The Leads board's cache: the rows are read again only when a lead is written, taken or flagged;
// otherwise the server's copy (and, in the browser, a 304) stands.
import { BOT_WRITE_WINDOW_MS, dropFingerprint, heldFingerprint } from "@/lib/board-fp";
import { describe, expect, it } from "vitest";
import { boardCount, boardFingerprint, cachedRows, rowsEtag } from "@/lib/board-cache";
import { accept } from "@/lib/claims";
import { memoryDb } from "@/lib/db";
import { raiseFlag } from "@/lib/flags";
import { writeLead, type Actor } from "@/lib/leads";
import { createTenant } from "@/lib/tenants";

const ENGINE: Actor = { kind: "bot", name: "Lead Gen", via: "engine" };

describe("board cache", () => {
  it("keeps the rows until a lead, a claim or a flag changes", async () => {
    const db = await memoryDb();
    const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu" });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await writeLead(db, tenant.id, {}, { business: `Shop ${i}`, website: `https://shop${i}.example` }, ENGINE, { create: true });
      if (!r.ok) throw new Error(r.message);
      ids.push(r.lead.id);
    }
    expect(await boardCount(db, tenant.id)).toBe(3);
    const a = await cachedRows(db, tenant.id, owner.id, "board");
    expect(a.hit).toBe(false);
    expect(a.rows).toHaveLength(3);
    expect(typeof a.rows[0].updatedAt).toBe("string");
    expect((await cachedRows(db, tenant.id, owner.id, "board")).hit).toBe(true);
    // the table is its own copy
    expect((await cachedRows(db, tenant.id, owner.id, "table")).hit).toBe(false);

    const fp0 = await boardFingerprint(db, tenant.id);
    await writeLead(db, tenant.id, { id: ids[0] }, { industry: "Bakery" }, ENGINE);
    const fp1 = await boardFingerprint(db, tenant.id);
    expect(fp1).not.toBe(fp0);
    // a bot's write is held up to a minute (lib/board-fp.ts): the copy still stands
    expect((await cachedRows(db, tenant.id, owner.id, "board")).hit).toBe(true);
    dropFingerprint(tenant.id); // the minute is up
    const b = await cachedRows(db, tenant.id, owner.id, "board");
    expect(b.hit).toBe(false);
    expect(b.rows.find((r) => r.id === ids[0])?.industry).toBe("Bakery");

    // a person taking a lead shows at once
    await accept(db, tenant.id, ids[1], owner.id);
    const fp2 = await boardFingerprint(db, tenant.id);
    expect(fp2).not.toBe(fp1);
    expect((await cachedRows(db, tenant.id, owner.id, "board")).rows.find((r) => r.id === ids[1])?.mine).toBe(true);

    // a person's edit too
    await writeLead(db, tenant.id, { id: ids[1] }, { industry: "Florist" }, { kind: "person", name: "Olu", userId: owner.id });
    expect((await cachedRows(db, tenant.id, owner.id, "board")).rows.find((r) => r.id === ids[1])?.industry).toBe("Florist");

    // the Validator's flag is a bot's: held, then shown
    await raiseFlag(db, tenant.id, ids[2], "LD03", "not a package name", "validator");
    expect(await boardFingerprint(db, tenant.id)).not.toBe(fp2);
    dropFingerprint(tenant.id);
    expect((await cachedRows(db, tenant.id, owner.id, "board")).rows.find((r) => r.id === ids[2])?.openFlags).toBe(1);

    // the ETag is per person and tab
    expect(rowsEtag("x", "u1", "board")).not.toBe(rowsEtag("x", "u2", "board"));
    expect(rowsEtag("x", "u1", "board")).not.toBe(rowsEtag("x", "u1", "table"));
  });
});

describe("the held fingerprint", () => {
  it("stands a minute for bot writes, then reads fresh; a person's write drops it", async () => {
    let n = 0;
    const read = async () => `fp${++n}`;
    dropFingerprint("t");
    expect(await heldFingerprint("t", read, 0)).toBe("fp1");
    expect(await heldFingerprint("t", read, BOT_WRITE_WINDOW_MS - 1)).toBe("fp1"); // held: no read
    expect(n).toBe(1);
    expect(await heldFingerprint("t", read, BOT_WRITE_WINDOW_MS)).toBe("fp2"); // the minute is up
    dropFingerprint("t");
    expect(await heldFingerprint("t", read, BOT_WRITE_WINDOW_MS + 1)).toBe("fp3"); // a person wrote
    expect(BOT_WRITE_WINDOW_MS).toBe(60_000);
  });
});

describe("the Table's first rows", () => {
  it("leave out the long cells and keep everything else", async () => {
    const { slimRow, SLIM_FIRST } = await import("@/lib/board-cache");
    const row = { id: "1", business: "Shop", draftEmail: "Hello…", notes: "n", painPoint: "p", city: "NYC" };
    const s = slimRow(row);
    expect(s).toEqual({ id: "1", business: "Shop", city: "NYC" });
    expect(SLIM_FIRST).toContain("draftEmail");
    expect(row.draftEmail).toBe("Hello…"); // the copy is untouched
  });
});
