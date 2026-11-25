// Settings → People, layout A: one Save writes only what changed; a rate under an approved week is
// locked; the email is not an editable field; a new sign-in code says what it does; removing asks once inline; the
// result notice leaves the address.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { rateLocks, rateToWrite, type RateRow } from "@/lib/rates";
import { sectionOf } from "@/lib/settings-nav";

const src = (f: string) => readFileSync(path.join(process.cwd(), f), "utf8");
const cur = { hourly: 12, outcomeBonus: 3, currency: "USD", from: "2026-11-01" };

describe("one Save writes a rate only when the rate changed", () => {
  it("a name or role change with the rate form prefilled writes no rate row", () => {
    expect(rateToWrite(cur, { touched: false, hourly: 12, outcomeBonus: 3, currency: "USD", from: "2026-11-16" })).toBeNull();
    // touched but put back as it was, on its own date: nothing
    expect(rateToWrite(cur, { touched: true, hourly: 12, outcomeBonus: 3, currency: "usd", from: "2026-11-01" })).toBeNull();
    // nothing given at all: nothing
    expect(rateToWrite(cur, { touched: true, from: "2026-11-16" })).toBeNull();
  });
  it("a changed hourly, bonus, currency or date writes one", () => {
    expect(rateToWrite(cur, { touched: true, hourly: 13, outcomeBonus: 3, currency: "USD", from: "2026-11-16" })).toEqual({ hourly: 13, outcomeBonus: 3, currency: "USD", from: "2026-11-16" });
    expect(rateToWrite(cur, { touched: true, hourly: 12, outcomeBonus: 4, currency: "USD", from: "2026-11-01" })?.outcomeBonus).toBe(4);
    expect(rateToWrite(cur, { touched: true, hourly: 12, outcomeBonus: 3, currency: "EUR", from: "2026-11-01" })?.currency).toBe("EUR");
    expect(rateToWrite(cur, { touched: true, hourly: 12, outcomeBonus: 3, currency: "USD", from: "2026-11-20" })?.from).toBe("2026-11-20");
  });
  it("the route writes the rate only through rateToWrite and only when its fields were touched", () => {
    const r = src("app/api/settings/route.ts");
    expect(r).toMatch(/if \(form\.get\("rateTouched"\) === "1"\)/);
    expect(r).toMatch(/const write = rateToWrite\(cur/);
    expect(r).toMatch(/if \(write\) \{/);
    expect(["person", "removeRate", "name"].map(sectionOf)).toEqual(["people", "people", "people"]);
  });
});

describe("rates under approved weeks are locked", () => {
  const h: RateRow[] = [
    { effectiveFrom: "2026-10-01", hourly: 10, outcomeBonus: 3, currency: "USD" },
    { effectiveFrom: "2026-11-01", hourly: 12, outcomeBonus: 3, currency: "USD" },
    { effectiveFrom: "2026-12-01", hourly: 14, outcomeBonus: 3, currency: "USD" },
  ];
  it("a rate an approved week lies under is locked; the others can be corrected or removed", () => {
    expect([...rateLocks(h, ["2026-10-26"])]).toEqual(["2026-10-01", "2026-11-01"]); // that week runs to 11-01
    expect([...rateLocks(h, ["2026-11-09"])]).toEqual(["2026-11-01"]);
    expect([...rateLocks(h, [])]).toEqual([]);
    expect([...rateLocks(h, ["2026-12-07"])]).toEqual(["2026-12-01"]); // the last rate runs on
  });
  it("removing a locked rate is refused by the route", () => {
    const r = src("app/api/settings/route.ts");
    expect(r).toMatch(/if \(rateLocks\(history, \(await approvedWeeks\(d, g\.who\.tenantId\)\)\.get\(target\.id\) \?\? \[\]\)\.has\(from\)\) return back/);
  });
});

describe("the page", () => {
  const list = src("app/settings/people/people-list.tsx");
  it("shows the email as text with what to do instead, never as an input", () => {
    expect(list).toMatch(/The email can&apos;t be changed here: remove \{first\} and add them again with the new address\./);
    expect(list).not.toMatch(/<input[^>]*p\.email/);
  });
  it("offers no sign-in code (removed 11-23) and asks once, inline, before removing anyone or a rate", () => {
    expect(list).not.toMatch(/sign-in code/);
    expect(list).toMatch(/can no longer sign in; their hours and outcomes stay\. Add them again to restore\./);
    expect(list).not.toMatch(/window\.confirm/);
    expect(list).toMatch(/Remove the rate from \$\{removeRate\}\?/);
  });
  it("prints the current rate once, saves with the loading orb, and the notice leaves the address", () => {
    expect(list).toMatch(/p\.rate && p\.may\.seePay && !isOpen \?/);
    expect(list).toMatch(/<PixelLoader inline active=\{busy\} label="Saving…" \/>/);
    const notice = src("app/settings/notice.tsx");
    expect(notice).toMatch(/searchParams\.delete\("msg"\)/);
    expect(notice).toMatch(/role="status"/);
    expect(notice).toMatch(/aria-label="Dismiss"/);
  });
});
