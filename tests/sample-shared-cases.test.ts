// The page rules Peek and the engine share: the engine's own cases, copied here from
// tests/fixtures/ in the engine repo (site_page.html_problems runs the same ones). Refresh both files when the engine's
// change; a case Peek judges differently fails here.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkPage } from "@/lib/sample-page";

const read = (f: string) => JSON.parse(readFileSync(path.join(__dirname, "fixtures", f), "utf8"));
const feature = read("sample-feature-cases.json");
const contact = read("sample-contact-cases.json");

describe("the shared feature cases (589): two scripts, the open-now badge's hours, other scripts' words, reviewers", () => {
  for (const c of feature.cases as { name: string; html: string; refused: string[] }[])
    it(c.name, () => {
      const r = checkPage(c.html, { siteFacts: feature.facts, mapLink: feature.row.map_link, business: feature.row.business });
      expect(r.ok, r.ok ? "" : r.error).toBe(c.refused.length === 0);
    });
});

describe("the shared contact cases (588): phone, street, map and profiles only in the contact section, as the row holds them", () => {
  const kinds: Record<string, RegExp> = { phone: /phone number/, street: /street/, map: /map link/, social: /social link/, email: /email address/ };
  const L = contact.lead;
  for (const c of contact.cases as { name: string; html: string; refused: string[] }[])
    it(c.name, () => {
      const r = checkPage(c.html, { phone: L.phone, address: L.street, mapLink: L.map, instagramUrl: L.socials[0], businessEmail: L.email, siteFacts: { offers: ["x"] } });
      const shown = r.ok ? [] : Object.keys(kinds).filter((k) => kinds[k].test(r.error));
      expect(shown.sort()).toEqual([...c.refused].sort());
    });
});
