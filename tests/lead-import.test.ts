import { describe, expect, it } from "vitest";
import { memoryDb } from "@/lib/db";
import { autoMap, importReportCsv, mapRows, parseCsv, planImport, runImport } from "@/lib/lead-import";
import { getLead, historyOf, listLeads, writeLead } from "@/lib/leads";
import { createTenant } from "@/lib/tenants";

const CSV = `﻿Business Name,Website,E-mail,WhatsApp,Phone,Borough,Category,Owner,Title,Notes,Ignored
Acme Bakery,acmebakery.example,hello@acmebakery.example,https://wa.me/17185550100,(718) 555-0100,Queens,Bakery,Maria Lopez,Owner,"Met at the fair, ""great"" bread",x
"Bravo Barbers, LLC",https://www.bravo.example/,,,,Brooklyn,Barbershop,,,,
Cedar Dental,,cedar@gmail.example,,,Manhattan,Dental clinic,,,,
Acme Bakery Two,http://acmebakery.example/menu,,,,Queens,Bakery,,,,
cedar dental,,,,,manhattan,,,,,
,,,,,Queens,Florist,,,,
Delta Yoga,,,,,Brooklyn,Yoga,,,,
`;

describe("reading the file", () => {
  it("parses quotes, doubled quotes, commas inside quotes, a BOM and semicolons; maps headers by name", () => {
    const t = parseCsv(CSV);
    expect(t[0][0]).toBe("Business Name");
    expect(t[1][9]).toBe('Met at the fair, "great" bread');
    expect(t[2][0]).toBe("Bravo Barbers, LLC");
    expect(parseCsv("name;city\nA;Queens\r\n\r\nB;Bronx")).toEqual([["name", "city"], ["A", "Queens"], ["B", "Bronx"]]);
    expect(autoMap(t[0])).toEqual(["business", "website", "business_email", "whatsapp", "phone", "city", "industry", "contact_person", "contact_role", "notes", null]);
    expect(autoMap(["Name", "Company", "url"])).toEqual(["business", null, "website"]); // a field is taken once
  });
});

async function board() {
  const db = await memoryDb();
  const { tenant, owner } = await createTenant(db, "Acme", "acme", { email: "o@acme.example", name: "Olu Ade" });
  await writeLead(db, tenant.id, {}, { business: "Delta Yoga Studio", website: "https://deltayoga.example", location: "Astoria, NY, USA" }, { kind: "bot", name: "Lead Gen", via: "engine" }, { create: true });
  await writeLead(db, tenant.id, {}, { business: "Delta Yoga", location: "Brooklyn, NY, USA" }, { kind: "bot", name: "Lead Gen", via: "engine" }, { create: true });
  return { db, tenantId: tenant.id, who: { userId: owner.id, name: "Olu Ade" } };
}

describe("the dry run and the import", () => {
  const all = (rows: ReturnType<typeof mapRows>) => rows.map((r, i) => ({ ...r, row: i + 2 }));
  it("skips duplicates by website domain and by name plus city (on the board and in the file), rejects rows with no name", async () => {
    const { db, tenantId } = await board();
    const t = parseCsv(CSV);
    const rows = mapRows(t.slice(1), autoMap(t[0]));
    const plan = await planImport(db, tenantId, rows);
    expect(plan.map((l) => [l.row, l.outcome, l.batch])).toEqual([
      [2, "create", "email"],
      [3, "create", "listing"],
      [4, "create", "email"],
      [5, "skipped", undefined], // same website as row 2
      [6, "skipped", undefined], // same name and city as row 4
      [7, "rejected", undefined], // no business name
      [8, "skipped", undefined], // Delta Yoga in Brooklyn is on the board
    ]);
    expect(plan[3].reason).toBe("same website as row 2 of this file");
    expect(plan[4].reason).toBe("same name and city as row 4 of this file");
    expect(plan[6].reason).toBe("already on the board (same name and city): Delta Yoga");
    expect(plan[5].reason).toBe("no business name");
  });

  it("creates the new rows as the person, every cell in history, found by an import; the report is kept", async () => {
    const { db, tenantId, who } = await board();
    const t = parseCsv(CSV);
    const r = await runImport(db, tenantId, who, all(mapRows(t.slice(1), autoMap(t[0]))), "mined.csv", { now: new Date("2026-11-02T18:00:00Z") });
    expect([r.created, r.skipped, r.rejected]).toEqual([3, 3, 1]);
    const acme = (await listLeads(db, tenantId)).leads.find((l) => l.business === "Acme Bakery")!;
    expect(acme).toMatchObject({ website: "https://acmebakery.example", business_email: "hello@acmebakery.example", whatsapp: "https://wa.me/17185550100", phone: "(718) 555-0100", city: "Queens", industry: "Bakery", contact_person: "Maria Lopez", contact_role: "Owner", found_by: "import: owner file 2026-11-02", email_status: null });
    const h = await historyOf(db, tenantId, acme.id);
    expect(h.every((x) => x.actor.kind === "person" && x.actor.name === "Olu Ade" && x.outcome === "applied")).toBe(true);
    expect(h.map((x) => x.column).sort()).toEqual(["business", "business_email", "contact_person", "contact_role", "evidence", "found_by", "industry", "location", "notes", "phone", "website", "whatsapp"]);
    // a bot cannot overwrite what the person imported (person wins), but fills what is empty
    const bot = await writeLead(db, tenantId, { id: acme.id }, { industry: "Cafe", pain_point: "Pain point: a PDF menu" }, { kind: "bot", name: "Lead Enricher", via: "engine" });
    expect(bot.ok && [bot.written, bot.refused.map((x) => x.reason)]).toEqual([["pain_point"], ["person_wins"]]);
    const report = await importReportCsv(db, tenantId, r.id);
    expect(report!.name).toMatch(/^lead-import-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(report!.csv.split("\n")[0]).toBe("row,business,outcome,reason");
    expect(report!.csv).toContain('7,"",rejected,"no business name"');
    expect(report!.csv).toContain('2,"Acme Bakery",created,"created"');
    // a second import of the same file creates nothing
    const again = await runImport(db, tenantId, who, all(mapRows(t.slice(1), autoMap(t[0]))), "mined.csv");
    expect(again.created).toBe(0);
    expect(await getLead(db, tenantId, { id: acme.id })).toMatchObject({ business: "Acme Bakery" });
  });
});

describe("a Google Maps business export (the owner's file's header)", () => {
  it("maps out of the box: emails and categories as fallbacks, location from city and state, the address, the map link, the listing", async () => {
    const { readFileSync } = await import("node:fs");
    const { leadFields, recentImports, isMapsExport, MAPS_RULES, foundByOf } = await import("@/lib/lead-import");
    const t = parseCsv(readFileSync(new URL("./fixtures/maps-export.csv", import.meta.url), "utf8"));
    const m = autoMap(t[0]);
    const at = (h: string) => m[t[0].indexOf(h)];
    expect([at("name"), at("category"), at("phone"), at("email"), at("emails"), at("website"), at("address"), at("city"), at("state"), at("location_link"), at("rating"), at("review_count"), at("price_range"), at("place_id"), at("categories"), at("description"), at("status")]).toEqual([
      "business", "industry", "phone", "business_email", "emails", "website", "address", "city", "state", "map_link", "rating", "reviews", "price_range", "place_id", "categories", "notes", "status",
    ]);
    expect([at("latitude"), at("cid"), at("thumbnail"), at("open_hours")]).toEqual([null, null, null, null]);
    expect(isMapsExport(m)).toBe(true);
    const rows = mapRows(t.slice(1), m);
    expect(rows[1]).toMatchObject({ business: "Brooklyn Threads", business_email: "hello@brooklynthreads.example", industry: "Clothing store" }); // from emails and categories
    expect(rows[2].business_email).toBeUndefined(); // "[]": no email, still a lead
    const foundBy = foundByOf(true, new Date("2026-11-02T18:00:00Z"));
    expect(foundBy).toBe("import: google maps 2026-11-02");
    expect(leadFields(rows[0], { foundBy, maps: true, packageForWebsite: "SMB Website Care Retainer" })).toMatchObject({
      business: "Hem Story - Staten Island",
      website: "http://www.hemstory.example/",
      location: "Staten Island, NY, USA",
      address: "1171, 240 Page Ave #103, Staten Island, NY 10307, United States",
      industry: "Women's clothing store",
      map_link: "https://www.google.com/maps/place/Hem+Story/data=!4m7!3m6!1s0x0:0x1",
      evidence: "http://www.hemstory.example/",
      package: "SMB Website Care Retainer",
      listing: { rating: 4.3, reviews: 14, place_id: "ChIJexample0001" },
      notes: "Casual, California-inspired clothing.",
      found_by: "import: google maps 2026-11-02",
    });
    // no website: evidence is the map link, no package; the listing-only note
    expect(leadFields(rows[2], { foundBy, maps: true, packageForWebsite: "SMB Website Care Retainer", listingOnly: true })).toMatchObject({ website: null, evidence: "https://www.google.com/maps/place/Bronx+Kids+Wear/data=!4m7", package: null, notes: expect.stringMatching(/^No email, listing only\./) });
    // an Instagram page is not a website: it goes to Source pages
    expect(leadFields(rows[10], { foundBy })).toMatchObject({ website: null, source_pages: "https://www.instagram.com/instathrift\nhttps://www.google.com/maps/place/Insta+Thrift" });

    const { db, tenantId, who } = await board();
    const plan = await planImport(db, tenantId, rows, MAPS_RULES);
    expect(plan.map((l) => [l.business, l.outcome, l.batch ?? l.reason])).toEqual([
      ["Hem Story - Staten Island", "create", "email"],
      ["Brooklyn Threads", "create", "email"],
      ["Bronx Kids Wear", "create", "listing"],
      ["Hoboken Linen", "create", "email"], // New Jersey is kept
      ["Philly Denim", "excluded", "outside NY and NJ"],
      ["Gone Boutique", "excluded", "closed"],
      ["Prism Shops - Bronx", "excluded", "a chain (3 or more branches in the file)"],
      ["Prism Shops - Queens", "excluded", "a chain (3 or more branches in the file)"],
      ["Prism Shops - Harlem", "excluded", "a chain (3 or more branches in the file)"],
      ["Quiet Tailor", "excluded", "neither an email nor a phone"],
      ["Insta Thrift", "create", "listing"],
    ]);
    expect(plan[10].social).toBe(true);
    // no rules: everything with a name is created, but for the second Prism branch (the same website as the first)
    expect((await planImport(db, tenantId, rows)).filter((l) => l.outcome === "create")).toHaveLength(10);

    // two batches, one report; the borough is read from the location
    const pick = (b: string) => plan.filter((l) => l.batch === b).map((l) => ({ ...rows[l.row - 2], row: l.row }));
    const notCreated = plan.filter((l) => l.outcome !== "create");
    const opts = { now: new Date("2026-11-02T18:00:00Z"), maps: true, packageForWebsite: "SMB Website Care Retainer" };
    const a = await runImport(db, tenantId, who, pick("email"), "maps.csv", { ...opts, batch: "email", excluded: notCreated });
    const b = await runImport(db, tenantId, who, pick("listing"), "maps.csv", { ...opts, batch: "listing", importId: a.id });
    expect(b.id).toBe(a.id);
    expect([a.created, b.created]).toEqual([3, 2]);
    const lead = (await listLeads(db, tenantId, { city: "Staten Island" })).leads[0];
    expect(lead).toMatchObject({ city: "Staten Island", state: "NY", phone: "+1 718-555-4178", found_by: "import: google maps 2026-11-02", package: "SMB Website Care Retainer", listing: { rating: 4.3, reviews: 14, place_id: "ChIJexample0001" } });
    const nj = (await listLeads(db, tenantId)).leads.find((l) => l.business === "Hoboken Linen")!;
    expect(nj).toMatchObject({ state: "NJ", location: "Hoboken, NJ, USA" });
    const kids = (await listLeads(db, tenantId)).leads.find((l) => l.business === "Bronx Kids Wear")!;
    expect(kids.notes).toMatch(/^No email, listing only\./);
    const [imp] = await recentImports(db, tenantId);
    expect(imp).toMatchObject({ id: a.id, file: "maps.csv", created: 5, skipped: 6, rejected: 0 });
    expect(imp.created_ids).toHaveLength(5);
    const report = await importReportCsv(db, tenantId, a.id);
    expect(report!.csv).toContain('4,"Bronx Kids Wear",created,"created (no email, listing only)"');
    expect(report!.csv).toContain('6,"Philly Denim",excluded,"outside NY and NJ"');
  });
});
