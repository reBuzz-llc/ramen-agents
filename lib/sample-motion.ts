// The engine's site_page.motion_problems ported: a slider whose slides are hidden with
// display:none shows no review without its script, and a keyframe animation outside the reduced-motion guard moves for someone
// who asked it not to. A hover transition is not refused: it moves only when a person points at it. One difference: the engine's
// pattern reads "animation: none" with a space as an animation; here it is none, with or without the space. Pure.

type CssRule = { at: string[]; selector: string; body: string };

const AT_READ = ["@media", "@supports", "@layer", "@container"];
const WORD = "[\\p{L}\\p{N}_-]";
const DISPLAY_NONE = new RegExp(`(?<!${WORD})display\\s*:\\s*none`, "iu");
const SWITCHED_OFF = new RegExp(`(?<!${WORD})animation(?:-name|-duration)?\\s*:\\s*(?:none|0)`, "iu");
const ANIMATES = new RegExp(`(?<!${WORD})animation(?:-name)?\\s*:(?!\\s*none)`, "iu");
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\/-]/g, (c) => (c === "-" ? "\\x2d" : `\\${c}`));

/** Each rule with its at-rules; @media, @supports, @layer and @container are read through, @keyframes left out. */
export function cssRules(raw: string, at: string[] = []): CssRule[] {
  const css = (raw ?? "").replace(/\/\*[\s\S]*?\*\//g, " ");
  const out: CssRule[] = [];
  let i = 0;
  while (i < css.length) {
    const b = css.indexOf("{", i);
    if (b < 0) break;
    const head = css.slice(i, b).split(";").at(-1)!.trim();
    let depth = 1;
    let j = b + 1;
    while (j < css.length && depth) {
      depth += Number(css[j] === "{") - Number(css[j] === "}");
      j++;
    }
    const body = css.slice(b + 1, j - 1);
    const low = head.toLowerCase();
    if (AT_READ.some((x) => low.startsWith(x))) out.push(...cssRules(body, [...at, low]));
    else if (!head.startsWith("@")) out.push({ at, selector: head, body });
    i = j;
  }
  return out;
}

const pageCss = (page: string) => [...page.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]).join(" ");
const inReduce = (r: CssRule) => r.at.some((a) => a.includes("reduced-motion") && a.slice(a.indexOf("reduced-motion") + 14).includes("reduce"));
const parts = (selector: string) => selector.split(",").map((s) => s.trim());

/** The page's motion faults, each a sentence; [] = fine. */
export function motionProblems(raw: string): string[] {
  const page = raw ?? "";
  const rules = cssRules(pageCss(page));
  const out: string[] = [];
  if (/\sdata-slide\b/i.test(page)) {
    const classes = new Set([...page.matchAll(/<[a-z]+\b([^>]*\sdata-slide\b[^>]*)>/gi)].flatMap((m) => [...m[1].matchAll(/class\s*=\s*["']([^"']*)/gi)].flatMap((k) => k[1].split(/\s+/).filter(Boolean))));
    const classMarks = [...classes].map((c) => new RegExp(`\\.${escapeRe(c)}(?!${WORD})`, "u"));
    const hides = rules.some((r) => {
      if (r.at.some((a) => a.includes("print")) || !DISPLAY_NONE.test(r.body)) return false;
      return parts(r.selector).some((part) => {
        const last = part.split(" ").at(-1)!;
        return last.includes("[data-slide]") || classMarks.some((m) => m.test(last));
      });
    });
    if (hides) out.push("the review slider hides its slides with display:none, so no review shows without the script: stack the slides in one box, change them by opacity and transform, and keep the first one visible with no script");
  }
  const off = new Set(rules.filter((r) => inReduce(r) && SWITCHED_OFF.test(r.body)).flatMap((r) => parts(r.selector)));
  const loose = rules
    .filter((r) => r.selector && !r.at.some((a) => a.includes("no-preference")) && !inReduce(r) && ANIMATES.test(r.body) && !(off.has("*") || parts(r.selector).every((s) => off.has(s))))
    .map((r) => r.selector.trim());
  if (loose.length) out.push(`an animation outside the reduced-motion guard (${loose.slice(0, 3).map((x) => x.slice(0, 40)).join(", ")}): put it inside @media (prefers-reduced-motion: no-preference), or switch it off in a reduce block`);
  return out;
}
