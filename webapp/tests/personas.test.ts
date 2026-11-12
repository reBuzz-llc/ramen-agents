import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
// @ts-expect-error TS5097
import { characterOf, frameBody, isCharacter, ownerEdit, personaSections, personaView, sha16 } from "../lib/personas.ts";

const TOML = `# allow list\n\n[lead-gen]\ncharacter = ["Who you are", "How a lead is found"]\n\n[scout]\ncharacter = ["How you work"]\n`;
const PERSONA = "# Lead Gen\n\nIntro line.\n\n## Who you are\n\nA finder.\n\n## Your goal (owner, 11-05)\n\nTen leads.\n### Detail\nStays inside.\n\n## Off limits\n\nNever pay.\n";

test("the marks: the CEO's character sections from the allow list (a heading's tail ignored), the rest the owner's", () => {
  assert.deepEqual(characterOf(TOML, "lead-gen"), ["Who you are", "How a lead is found"]);
  assert.deepEqual(characterOf(TOML, "the-ceo"), []);
  assert.deepEqual(characterOf(TOML, "nobody"), []);
  assert.equal(isCharacter("Who you are (owner, 11-09)", ["Who you are"]), true);
  const v = personaView(PERSONA, characterOf(TOML, "lead-gen"));
  assert.equal(v.preamble, "# Lead Gen\n\nIntro line.");
  assert.deepEqual(v.sections.map((s: { heading: string; owner: boolean }) => [s.heading, s.owner]), [["Who you are", false], ["Your goal (owner, 11-05)", true], ["Off limits", true]]);
  assert.match(v.sections[1].body, /### Detail\nStays inside\./);
});

test("an edit keeps the section's frame and refuses a line that would split it", () => {
  assert.equal(frameBody("\n\nTen leads.\n\n", " Twenty leads. "), "\n\nTwenty leads.\n\n");
  assert.deepEqual(frameBody("\nx\n", "## New"), { error: "a line starting with # or ## would split the persona into another section: use ### for a sub-heading" });
  assert.match((frameBody("\nx\n", "  ") as { error: string }).error, /empty/);
});

async function setup() {
  const dir = await mkdtemp(path.join(tmpdir(), "personas-"));
  await mkdir(path.join(dir, "lead-gen"));
  await writeFile(path.join(dir, "lead-gen", "persona.md"), PERSONA);
  const p = { bots: dir, store: path.join(dir, "persona-owner-sections.json"), sections: path.join(dir, "persona-sections.toml") };
  await writeFile(p.sections, TOML);
  await writeFile(p.store, JSON.stringify({ "lead-gen": { "Off limits": { sha1: "old", text: "old" }, "Your goal (owner, 11-05)": { sha1: "x", text: "x" } } }));
  // a stand-in for lib/ceo-changes.ts writeSection: replace while the body still reads as expected
  const write = async (file: string, heading: string, expect: string | null, put: string) => {
    const text = await readFile(file, "utf8");
    const hit = personaSections(text).find(([h]: [string, number, number]) => h === heading);
    if (!hit) return "missing";
    if (expect !== null && text.slice(hit[1], hit[2]).trim() !== expect.trim()) return "the section changed since";
    await writeFile(file, text.slice(0, hit[1]) + put + text.slice(hit[2]));
    return "";
  };
  return { dir, p, write };
}

test("the owner's edit: written in place, the Validator's hash updated to the new body; a CEO section and a stale edit refused", async () => {
  const { dir, p, write } = await setup();
  const file = path.join(dir, "lead-gen", "persona.md");
  const off = personaView(PERSONA, []).sections[2].body;
  assert.equal(await ownerEdit(p, "lead-gen", "Off limits", off, "Never pay. Never sign up.", write), "");
  const text = await readFile(file, "utf8");
  assert.match(text, /## Off limits\n\nNever pay\. Never sign up\.\n$/);
  assert.match(text, /## Your goal \(owner, 11-05\)\n\nTen leads\./);
  const seen = JSON.parse(await readFile(p.store, "utf8"));
  const body = "\nNever pay. Never sign up.\n";
  assert.deepEqual(seen["lead-gen"]["Off limits"], { sha1: createHash("sha1").update(body.trim()).digest("hex").slice(0, 16), text: body });
  assert.equal(seen["lead-gen"]["Off limits"].sha1, sha16(body));
  assert.equal(seen["lead-gen"]["Your goal (owner, 11-05)"].sha1, "x");
  assert.match(await ownerEdit(p, "lead-gen", "Who you are", "\n\nA finder.\n\n", "A hunter.", write), /character section/);
  assert.match(await ownerEdit(p, "lead-gen", "Off limits", off, "again", write), /changed since/);
  assert.match(await ownerEdit(p, "../x", "Off limits", off, "x", write), /no such member/);
});
