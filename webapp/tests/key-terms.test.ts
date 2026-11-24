import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// @ts-expect-error TS5097
import { needsTermsScript, TERMS_FIRST } from "../lib/key-terms.ts";

const source = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("a Gemini key goes through the script that asks; other keys do not", () => {
  assert.equal(needsTermsScript("gemini"), true);
  for (const name of ["groq", "zai", "openrouter", "tavily"]) assert.equal(needsTermsScript(name), false);
  assert.match(TERMS_FIRST, /sh scripts\/add-key\.sh gemini/);
});

test("every path that saves a key refuses Gemini before it saves", () => {
  const lib = source("lib/keys.ts");
  const body = lib.slice(lib.indexOf("export async function saveKey"));
  assert.ok(body.indexOf("needsTermsScript(p.name)") < body.indexOf("writeFile"), "saveKey checks first");
  const store = source("lib/providers-store.ts");
  const own = store.slice(store.indexOf("export async function saveProviderKey"));
  assert.ok(own.indexOf("needsTermsScript(p.name)") < own.indexOf("writeFile"), "saveProviderKey checks first");
  for (const [file, name, save] of [
    ["app/api/settings/provider-list/route.ts", "needsTermsScript(p.name)", "await saveProviderKey"],
    ["app/api/provider-finds/route.ts", "needsTermsScript(slug)", "await saveKey"],
  ]) {
    const text = source(file);
    assert.ok(text.includes(name), `${file} checks`);
    assert.ok(text.indexOf(name) < text.indexOf(save), `${file} checks before it saves`);
  }
});

test("the All providers row shows the script instead of Add key for Gemini", () => {
  const view = source("app/settings/providers/all-providers-view.tsx");
  assert.ok(view.includes('const terms = row.name === "gemini"'));
  assert.ok(view.indexOf("sh scripts/add-key.sh gemini") < view.indexOf("data-add-key"));
});
