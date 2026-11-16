// The family's answers (queue 572): common-data/local/family.toml, read and written in the shape
// scripts/family_answers.py writes, so sh scripts/setup.sh and the first-run page agree.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
const dir = mkdtempSync(path.join(tmpdir(), "family-"));
process.env.FAMILY_FILE = path.join(dir, "local", "family.toml");
// @ts-expect-error TS5097
import { answersOf, applyAnswers, domainList, familyMissing, parseFamily, readFamily, renderFamily, saveFamily, teamPeople } from "../lib/family.ts";

const page = { name: "Cobalt Web", sells: "websites for shops", buyers: "cafes and salons", place: "Springfield, IL", owner: "Sam", domains: "https://www.cobalt.example/, cobalt.example", steer: "Cafes first." };

test("the page's answers make the file setup.sh makes, and read back the same", async () => {
  const f = applyAnswers(null, page);
  assert.equal(f.company.signoff, "Regards,\nSam\n-- Cobalt Web");
  assert.deepEqual(f.company.own_domains, ["cobalt.example"]);
  assert.equal(f.target.market_short, "Springfield");
  assert.equal(f.target.trades, "cafes and salons");
  assert.equal(f.team[0].name, "Sam");
  await saveFamily(f);
  assert.equal(statSync(process.env.FAMILY_FILE!).mode & 0o777, 0o600);
  const text = readFileSync(process.env.FAMILY_FILE!, "utf8");
  assert.ok(text.indexOf("steer =") < text.indexOf("[company]"), "steer is top-level, before the first table");
  const back = await readFamily();
  assert.deepEqual(answersOf(back), answersOf(f));
  assert.deepEqual(familyMissing(back), []);
  assert.deepEqual(await teamPeople(), ["Sam"]);
});

test("Python's tomllib reads what this writes", () => {
  const f = applyAnswers(null, { ...page, signoff: 'Best,\nSam "the web" -- Cobalt' });
  const out = execFileSync("python3", ["-c", "import sys,tomllib,json; print(json.dumps(tomllib.loads(sys.stdin.read())))"], { input: renderFamily(f) }).toString();
  const d = JSON.parse(out);
  assert.equal(d.company.signoff, 'Best,\nSam "the web" -- Cobalt');
  assert.equal(d.steer, "Cafes first.");
  assert.equal(d.team[0].name, "Sam");
});

test("reads family_answers.py's file and keeps what the page does not ask", () => {
  const py = path.join(import.meta.dirname, "..", "..", "scripts", "family_answers.py");
  const file = path.join(dir, "py.toml");
  execFileSync("python3", [py, file], { env: { ...process.env, NAME: "Acme", SELLS: "apps", BUYERS: "clinics", PLACE: "Lyon, France", STEER: "x" } });
  const f = parseFamily(readFileSync(file, "utf8") + '\n[[team]]\nname = "Lee"\nrole = "calls"\n');
  assert.equal(f.company.name, "Acme");
  assert.equal(f.steer, "x");
  assert.equal(f.team.length, 2);
  const next = applyAnswers(f, { ...answersOf(f), owner: "Ana" });
  assert.equal(next.team.length, 2, "the second teammate stays");
  assert.equal(next.company.signoff, "Regards,\nAna\n-- Acme", "a default sign-off follows the new name");
});

test("a missing answer is refused; a bad domain is dropped", () => {
  assert.throws(() => applyAnswers(null, { ...page, sells: " " }), /what you sell/);
  assert.deepEqual(domainList("not a domain, shop.example/path, SHOP.example"), ["shop.example"]);
  assert.deepEqual(familyMissing(null).length, 4);
});
