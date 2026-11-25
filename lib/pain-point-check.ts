// The warning at save on a person's pain point or draft: the same two
// checks the Validator runs at write time (validator/checks.py FM08 and FM09), from the same lists
// (common-data/knowledge/pain-point-rules.json, copied as lib/pain-point-rules.json; tests/pain-point-check.test.ts
// fails when the copy drifts). Peek never blocks a person: it says what it found and asks "Save anyway?"; the person's cell
// always wins. Pure.
import { readFileSync } from "node:fs";
import RULES from "./pain-point-rules.json";

type Rules = { leftovers: string[]; name_min_chars: number; name_two_words_min: number; generic_words: string[]; chains: string[] };
const R = RULES as Rules;

// Python's \w and \b are Unicode-aware; JavaScript's are not, so letters and digits are named outright.
const WORD = "[\\p{L}\\p{N}_]";
const DROP = new RegExp(`(?<!${WORD})(?:the|llc|inc|corp|co|ltd|pllc|pc|dds|md)(?!${WORD})\\.?`, "giu");

/** checks.py _norm_name: "the", LLC/Inc/... and punctuation (but & and ') dropped, lower case, spaces collapsed. */
export function normName(s: string): string {
  // deaf462: apostrophes go first (the board writes both "Men's" and "Men’s")
  const a = (s || "").replace(/[’‘']/g, "").replace(DROP, " ");
  return a.toLowerCase().replace(/[^\p{L}\p{N}_\s&']/gu, " ").replace(/\s+/g, " ").trim();
}

let WORDS: Set<string> | null = null;
/** checks.py _dictionary: the system word list (/usr/share/dict/words, on this Mac as on the
 *  Validator's); a one-word lead name that is one of them ("Clothing") is no name. Empty where there is no list: then every
 *  one-word name is skipped, as the Validator does. */
export function dictionary(): Set<string> {
  if (WORDS === null) {
    try {
      WORDS = new Set(readFileSync("/usr/share/dict/words", "utf8").split("\n").map((w) => w.trim().toLowerCase()));
    } catch {
      WORDS = new Set();
    }
  }
  return WORDS;
}

const SUFFIX = new RegExp(`(?<!${WORD})(?:llc|inc|corp|co|ltd|pllc|pc|dds|md)(?!${WORD})\\.?`, "iu");
const SUFFIX_ALL = new RegExp(SUFFIX.source, "giu");
const escapeRe = (s: string) => s.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
/** Lower case, punctuation (but & and ') as spaces, spaces collapsed: checks.py's raw_t and full, without dropping words. */
const plain = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}_\s&']/gu, " ").replace(/\s+/g, " ").trim();
const THE = new RegExp(`(?<!${WORD})the(?!${WORD})`, "giu");

/** checks.py other_business_issue (FM08; `also` the row's trade): the board's other lead
 *  names found in the text; short, generic and chain names skipped; a one-word name that is a plain English word skipped;
 *  a name of plain words only matched only with its own capitals; a short name with a suffix ("Forest Hills DDS") matched
 *  only with its suffix; "" when none. */
export function otherBusinessIssue(text: string, own: string, names: string[], also: string[] = [], rules: Rules = R, words: Set<string> = dictionary()): string {
  const t = ` ${normName(text)} `;
  // deaf462: the row's own trade ("Drafting Services") is never another business
  const mine = also.map(normName).filter(Boolean);
  const rawT = ` ${plain(text || "")} `;
  const me = normName(own);
  const generic = new Set(rules.generic_words.map((g) => g.toLowerCase()));
  const chains = new Set(rules.chains.map(normName));
  const mn = rules.name_min_chars || 8;
  const two = rules.name_two_words_min || 4;
  for (const n of names) {
    const k = normName(n);
    if (!k || k === me || me.includes(k) || k.includes(me) || generic.has(k) || chains.has(k) || mine.some((m) => k === m || m.includes(k))) continue;
    const ws = k.split(" ");
    if (ws.length === 1 && (!words.size || words.has(k))) continue;
    if (words.size && ws.every((w) => words.has(w))) {
      // a name of plain words only ("All in One", "Green Garden") is a phrase in prose: it counts only written with the
      // name's own capitals, never in lower case (checks.py 13014a2)
      const cap = (n || "").trim().replace(/^the\s+/i, "").replace(SUFFIX_ALL, " ").replace(/\s+/g, " ").trim().replace(/^[ .,]+|[ .,]+$/g, "");
      if (cap && cap !== cap.toLowerCase() && new RegExp(`(?<!${WORD})${escapeRe(cap)}(?!${WORD})`, "u").test(text || ""))
        return `names another lead's business, '${n.trim().slice(0, 60)}': write only about this row's business`;
      continue;
    }
    if (!(k.length >= mn || (ws.length >= 2 && ws.slice(0, 2).every((w) => w.length >= two)))) continue;
    if (SUFFIX.test(n || "") && ws.length <= 2) {
      const full = ` ${plain((n || "").replace(THE, " "))} `;
      if (full.trim() && rawT.includes(full)) return `names another lead's business, '${n.trim().slice(0, 60)}': write only about this row's business`;
      continue;
    }
    if (t.includes(` ${k} `)) return `names another lead's business, '${n.trim().slice(0, 60)}': write only about this row's business`;
  }
  return "";
}

/** checks.py leftover_issue (FM09): a research-tool leftover in the text; "" when none. */
export function leftoverIssue(text: string, rules: Rules = R): string {
  const low = (text || "").toLowerCase();
  const hit = rules.leftovers.find((p) => low.includes(p.toLowerCase()));
  return hit ? `carries a research note, not words for the business: '${hit}'` : "";
}

/** The cells a person's save is checked on, and how each is named in the warning. */
export const CHECKED: Record<string, string> = { pain_point: "The pain point", draft_email: "The email draft", draft_whatsapp: "The WhatsApp draft" };

/** What to ask the person before saving these fields, or "" (the first finding of each checked cell, one per line). */
export function saveWarning(fields: Record<string, unknown>, own: string, names: string[], also: string[] = []): string {
  const lines: string[] = [];
  for (const [key, label] of Object.entries(CHECKED)) {
    const v = fields[key];
    if (typeof v !== "string" || !v.trim()) continue;
    const issue = leftoverIssue(v) || otherBusinessIssue(v, own, names, also);
    if (issue) lines.push(`${label} ${issue}.`);
  }
  return lines.join("\n");
}
