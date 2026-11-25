// A sample page may show the phone in the lead's site facts once that
// number is marked checked, and the row's different number is then refused. The row is never changed, and a person settles the
// difference. Invented numbers (555 exchange).
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkedFactsPhone, contactProblems, pagePhones, phoneDiffers } from "@/lib/sample-contact";
import { checkPage } from "@/lib/sample-page";

const ROW = "+1 718 555 0100";
const LISTING = "(212) 555-0199";
const checked = { phone: LISTING, phone_checked: "212-555-0199" };
const footer = (n: string) => `<main><h1>Gamma Grill</h1></main><footer id="contact"><p><a href="tel:${n.replace(/[^\d+]/g, "")}">${n}</a></p></footer>`;
const phoneProblems = (n: string, row: string | null, facts: unknown) => contactProblems(footer(n), { phone: pagePhones(row, facts) }).filter((p) => p.includes("phone"));
const page = (n: string) => `<!doctype html><html lang="en"><head><title>G</title></head><body>${footer(n)}</body></html>`;
const pageSays = (n: string, phone: string | null, siteFacts: unknown) => JSON.stringify(checkPage(page(n), { phone, siteFacts }));

describe("the checked facts phone (817)", () => {
  it("allows the checked number and refuses the row's different one", () => {
    expect(phoneProblems(LISTING, ROW, checked)).toEqual([]);
    expect(phoneProblems(ROW, ROW, checked).length).toBeGreaterThan(0);
    expect(phoneProblems("(917) 555-0142", ROW, checked).length).toBeGreaterThan(0);
  });

  it("says where the allowed number is, in the page check itself", () => {
    expect(pageSays(ROW, ROW, checked)).toContain("only the one checked in its site facts");
    expect(pageSays(LISTING, ROW, checked)).not.toContain("not the business's");
    expect(pageSays(LISTING, ROW, { phone: LISTING })).toContain("only the one on its row");
  });

  it("keeps the row's number when the facts phone is missing, unchecked or edited after the check", () => {
    for (const facts of [null, undefined, "text", {}, { phone: "" }, { phone: LISTING }, { phone: LISTING, phone_checked: "" }, { phone: LISTING, phone_checked: "(212) 555-0111" }, { phone: LISTING, phone_checked: 2125550199 }, { phone: "555", phone_checked: "555" }]) {
      expect(checkedFactsPhone(facts)).toBe("");
      expect(pagePhones(ROW, facts)).toEqual([ROW]);
      expect(phoneProblems(ROW, ROW, facts)).toEqual([]);
      expect(phoneProblems(LISTING, ROW, facts).length).toBeGreaterThan(0);
    }
  });

  it("treats the same number in two formats as one, and either may be shown", () => {
    const same = { phone: "718-555-0100", phone_checked: "(718) 555 0100" };
    expect(pagePhones(ROW, same)).toEqual(["718-555-0100", ROW]);
    expect(phoneProblems("(718) 555-0100", ROW, same)).toEqual([]);
    expect(phoneProblems(ROW, ROW, same)).toEqual([]);
    expect(phoneDiffers(ROW, same)).toBe("");
  });

  it("uses a checked number for a lead whose Phone cell is empty, and shows none without one", () => {
    expect(pagePhones("", checked)).toEqual([LISTING]);
    expect(pagePhones(null, { phone: LISTING })).toEqual([]);
  });
});

describe("the line on the lead (817)", () => {
  it("appears when the row and the facts hold different numbers, checked or not", () => {
    expect(phoneDiffers(ROW, checked)).toBe(LISTING);
    expect(phoneDiffers(ROW, { phone: LISTING })).toBe(LISTING);
  });

  it("stays away when there is nothing to settle", () => {
    for (const [row, facts] of [[ROW, null], [ROW, {}], [ROW, { phone: "" }], ["", checked], [null, checked], [ROW, { phone: 7185550100 }], [ROW, { phone: "12" }]] as const) expect(phoneDiffers(row, facts)).toBe("");
  });

  it("is on the drawer, and the send screens still read the row's number", () => {
    const view = readFileSync(path.join(process.cwd(), "app/leads/leads-view.tsx"), "utf8");
    expect(view).toContain("The listing shows a different phone:");
    for (const f of ["app/send-pack.tsx", "app/whatsapp-pack.tsx", "lib/whatsapp-pack.ts", "lib/send-next.ts"]) {
      const src = readFileSync(path.join(process.cwd(), f), "utf8");
      expect(src).not.toMatch(/phone_checked|checkedFactsPhone|pagePhones/);
    }
  });
});
