// The Leads CSV import (queue 572): columns matched by name, unmatched ones reported, quoted cells kept whole, and the
// board's rule that an import never overwrites a filled cell.
import assert from "node:assert/strict";
import { test } from "node:test";
process.env.LOCAL_BOARD_FILE = ":memory:";
// @ts-expect-error TS5097
import { csvRows, mapHeaders, parseCsv, csvCell } from "../lib/csv-import.ts";
// @ts-expect-error TS5097
import { closeBoard, getRow, importLeads, LEAD_FIELDS, writeRow } from "../lib/local-board.ts";

test("CSV cells: quotes, doubled quotes, commas and newlines inside quotes, CRLF, a BOM", () => {
  assert.deepEqual(parseCsv('﻿a,b\r\n"x, y","say ""hi""\nthere"\r\n'), [["a", "b"], ["x, y", 'say "hi"\nthere']]);
});

test("columns by name: the board's labels and keys and an older board's names; Stage left out; the rest reported", () => {
  const { map, unmatched } = mapHeaders(["Name", "Website", "Company size", "How can I help", "Stage", "Favourite colour", "google map location"], LEAD_FIELDS);
  assert.deepEqual(map, ["business", "website", "size", "package", null, null, "map_link"]);
  assert.deepEqual(unmatched, ["Favourite colour"]);
  const { rows, columns } = csvRows("Business,Industry\nCobalt Bakery,Bakery\n,\n", LEAD_FIELDS);
  assert.equal(columns, 2);
  assert.deepEqual(rows, [{ business: "Cobalt Bakery", industry: "Bakery" }]);
});

test("an import adds new leads and only fills a known lead's empty cells, never a filled one", () => {
  closeBoard();
  const person = { kind: "person" as const, name: "Sam" };
  const a = writeRow("leads", {}, { business: "Cobalt Bakery", website: "cobalt.example", industry: "Bakery" }, person, { create: true });
  assert.ok(a.ok);
  const r = importLeads([{ business: "Cobalt Bakery", website: "https://www.cobalt.example", industry: "Café", size: "2-10" }, { business: "Harbor Tailors" }, { website: "x.example" }], person);
  assert.deepEqual([r.created, r.filled, r.skipped, r.keptFilled], [1, 1, 1, 2]); // the website (written differently) and the industry stay as they were
  if (a.ok) {
    const row = getRow(a.row.id)!.row;
    assert.equal(row.industry, "Bakery");
    assert.equal(row.size, "2-10");
  }
  closeBoard();
});

test("the export: a label header Import reads back, quoting, and no formula runs in a spreadsheet", () => {
  assert.equal(csvCell('say "hi", then go'), '"say ""hi"", then go"');
  assert.equal(csvCell("=HYPERLINK(\"x\")"), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell("-1"), "'-1");
  assert.equal(csvCell(["a", "b"]), '"a, b"');
  assert.equal(csvCell(null), "");
  const head = ["Business", "Website", "Business email"].map(csvCell).join(",");
  const { rows } = csvRows(`${head}\nCobalt Bakery,https://cobalt.example,hi@cobalt.example\n`, LEAD_FIELDS);
  assert.equal(rows[0].business, "Cobalt Bakery");
});
