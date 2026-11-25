// The rules Peek and the Validator share for a team member's rewrite of a Writer draft,
// ported from the Validator's validator/template_rules.py; both run the same cases (tests/fixtures/template-rules-cases.json,
// copied from the fleet), so the two sides cannot disagree. Pure, no I/O.
//   - isSmallFix(before, after, row): only the lead's own words changed, or under 15% of the words;
//   - groupOf(row): the row's package, the key the Writer picks its template by ("no package, ..." when it has none);
//   - groupWords(group, n): that group in plain words for the prompt and the card;
//   - makeTemplate(after, row): the person's text with the row's own values as <business> <contact> <city> <pain_point>;
//   - textKey(text): the key a declined or one-off text is remembered by.
import { createHash } from "node:crypto";

export const SMALL_FIX = 0.15;
export type RuleRow = { business?: string | null; contact?: string | null; city?: string | null; website?: string | null; package?: string | null; pain_point?: string | null };

const tokens = (text: string) => (text ?? "").toLowerCase().match(/[a-z0-9']+/g) ?? [];
const ownTokens = (row: RuleRow) => new Set([row.business, row.contact, row.city].flatMap((v) => tokens(String(v ?? ""))));
const counter = (xs: string[]) => xs.reduce((m, t) => m.set(t, (m.get(t) ?? 0) + 1), new Map<string, number>());

/** The share of the words (the lead's own left out) that changed, counted both ways. */
export function changeRatio(before: string, after: string, row: RuleRow): number {
  const own = ownTokens(row);
  const a = counter(tokens(before).filter((t) => !own.has(t)));
  const b = counter(tokens(after).filter((t) => !own.has(t)));
  const total = [...a.values(), ...b.values()].reduce((x, y) => x + y, 0);
  if (!total) return 0;
  let diff = 0;
  for (const t of new Set([...a.keys(), ...b.keys()])) diff += Math.abs((a.get(t) ?? 0) - (b.get(t) ?? 0));
  return diff / total;
}
export const isSmallFix = (before: string, after: string, row: RuleRow) => changeRatio(before, after, row) < SMALL_FIX;

export const NO_SITE_PACKAGE = "Starter Website";
/** The key the Writer picks its template by: the package exactly as the board writes it, else "no package, ...". */
export function groupOf(row: RuleRow): string {
  const pkg = String(row.package ?? "").trim();
  if (pkg) return pkg;
  return String(row.website ?? "").trim() ? "no package, own website" : "no package, no website";
}
/** "the other 12 no-website leads", "the other 3 SMB Website Care Retainer leads", "the other 2 leads with no package and
 *  no website". */
export function groupWords(group: string, n: number): string {
  if (group === NO_SITE_PACKAGE) return `the other ${n} no-website leads`;
  if (group.startsWith("no package, ")) return `the other ${n} leads with no package and ${group.split(", ").slice(1).join(", ")}`;
  return `the other ${n} ${group} leads`;
}

function pain(row: RuleRow): string {
  const first = row.pain_point ? String(row.pain_point).split(/\r?\n/)[0] : "";
  return first.toLowerCase().startsWith("pain point:") ? first.slice(first.indexOf(":") + 1).trim() : first.trim();
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** [template, placeholders used]: each value replaced case-insensitively, longest first; one under 3 characters is left
 *  alone (it would match inside words). */
export function makeTemplate(after: string, row: RuleRow): [string, string[]] {
  const contact = String(row.contact ?? "").trim();
  const parts = contact.split(/\s+/).filter(Boolean);
  const values: [string, string][] = [
    [String(row.business ?? "").trim(), "<business>"],
    [contact, "<contact>"],
    [parts.length > 1 ? parts[0] : "", "<contact>"],
    [String(row.city ?? "").trim(), "<city>"],
    [pain(row), "<pain_point>"],
  ];
  let out = after;
  const used: string[] = [];
  for (const [value, ph] of values.filter(([v]) => v.length >= 3).sort((x, y) => y[0].length - x[0].length)) {
    const rx = new RegExp(`(?<![\\p{L}\\p{N}_])${escape(value)}(?![\\p{L}\\p{N}_])`, "giu");
    if (rx.test(out)) {
      out = out.replace(rx, ph);
      if (!used.includes(ph)) used.push(ph);
    }
  }
  return [out, used];
}

export const textKey = (text: string) => createHash("sha256").update((text ?? "").toLowerCase().split(/\s+/).filter(Boolean).join(" "), "utf8").digest("hex");
