// A no-site lead's street usually lives only in its saved facts. Peek accepts the row's address,
// else the facts' address, as the engine does; a street in neither is still refused, and a row's address is not overruled.
import { describe, expect, it } from "vitest";
import { contactProblems } from "@/lib/sample-contact";
import { checkPage, streetsOf } from "@/lib/sample-page";

const page = (street: string, body = "") => `<!doctype html><html><head><title>Sample</title></head><body><main><h1>Sample</h1>${body}</main><footer>${street}</footer></body></html>`;
const refused = (r: ReturnType<typeof checkPage>) => (r.ok ? "" : r.error);

describe("the street on a sample page (777)", () => {
  const facts = { address: "330 Broad Ave, Palisades Park, NJ 07650" };

  it("reads the facts' address when the row's cell is empty", () => {
    expect(streetsOf({ address: "", siteFacts: facts })).toEqual(["330 Broad Ave"]);
    expect(streetsOf({ address: null, siteFacts: facts })).toEqual(["330 Broad Ave"]);
  });

  it("passes the facts' street in the footer", () => {
    expect(checkPage(page("330 Broad Ave, Palisades Park, NJ"), { address: "", siteFacts: facts }).ok).toBe(true);
  });

  it("refuses a street in neither the row nor the facts", () => {
    expect(refused(checkPage(page("12 Main Street, Fort Lee, NJ"), { address: "", siteFacts: facts }))).toMatch(/not the business's \(only the address on its row or in its facts\)/);
    expect(refused(checkPage(page("12 Main Street"), { address: "", siteFacts: {} }))).toMatch(/not the business's/);
  });

  it("keeps the facts' street out of the page's body", () => {
    expect(refused(checkPage(page("330 Broad Ave", "<p>Visit 330 Broad Ave</p>"), { address: "", siteFacts: facts }))).toMatch(/outside the contact\/footer section/);
  });

  it("lets the row's address win over a different one in the facts", () => {
    const lead = { address: "41-08 149th Place, Flushing, NY", siteFacts: facts };
    expect(streetsOf(lead)).toEqual(["41-08 149th Place"]);
    expect(checkPage(page("41-08 149th Place"), lead).ok).toBe(true);
    expect(refused(checkPage(page("330 Broad Ave"), lead))).toMatch(/not the business's/);
  });

  it("does not read a time as a house number (a sample's footer line)", () => {
    const line = "Open daily 10:30 AM to 9 PM 330 Broad Ave";
    expect(contactProblems(page(line), { street: "330 Broad Ave" })).toEqual([]);
    expect(checkPage(page(line), { address: "", siteFacts: facts }).ok).toBe(true);
    expect(checkPage(page("Open daily 10:30 am to 9 pm 330 Broad Ave"), { address: "", siteFacts: facts }).ok).toBe(true);
  });

  it("still refuses a wrong street right after a time", () => {
    expect(refused(checkPage(page("Open daily 10:30 AM to 9 PM 12 Main Street"), { address: "", siteFacts: facts }))).toMatch(/not the business's/);
  });

  it("ignores a facts address that is not text", () => {
    expect(streetsOf({ address: "", siteFacts: { address: { line: "330 Broad Ave" } } })).toEqual([]);
  });
});
