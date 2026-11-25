// A Google Doc pasted into a lead keeps its formatting. The cell itself stays plain text, which is what the bots,
// the checks and the History read; the formatted copy sits beside it (lib/rich-text-db.ts) and shows only while it matches the
// cell. This file has no dependency, so the board carries it; the cleaner is in lib/rich-clean.ts and loads on a paste.

/** The long cells a person writes in. */
export const RICH_FIELDS = new Set(["pain_point", "draft_email", "draft_whatsapp", "draft_followup", "notes"]);
export const MAX_RICH = 300_000;
export const PICTURES_NOTE = "Pictures from the document are not kept. All other formatting is.";

/** Google Docs marks what it puts on the clipboard. Any other paste stays plain, as it always was. */
export const isDocsPaste = (html: string) => /docs-internal-guid-/.test(html);
export const hasPictures = (html: string) => /<img\b/i.test(html);

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Plain text as HTML, line breaks kept. */
export const textToHtml = (s: string) => escapeHtml(s).replace(/\r?\n/g, "<br>");

/** The formatted copy of a draft whose Copy adds a closing line (the sample link, the attachments). Null if the added text is
 *  not simply at the end: the plain text is then the safe copy. */
export function richWithEnding(html: string, plain: string, final: string): string | null {
  if (final === plain) return html;
  const base = plain.trimEnd();
  if (!final.startsWith(base)) return null;
  return `${html}<br>${textToHtml(final.slice(base.length).replace(/^\s+/, ""))}`;
}

const BLOCKS = new Set(["P", "DIV", "H1", "H2", "H3", "H4", "H5", "H6", "UL", "OL", "LI", "TABLE", "TR", "BLOCKQUOTE", "PRE", "HR"]);

/** The plain text of an edited document, for the cell: a line per paragraph, a blank line where the document has one, bullets and
 *  numbers written out, table cells apart by a tab. (innerText would put a blank line between all paragraphs.) */
export function plainOf(root: Node): string {
  let out = "";
  // no new line right after a bullet or a cell's start: Google Docs wraps the text of both in a paragraph
  const line = () => {
    if (out && !/(\n|\t|(^|\n)(• |\d+\. ))$/.test(out)) out += "\n";
  };
  const walk = (n: Node) => {
    if (n.nodeType === 3) {
      out += (n.textContent ?? "").replace(/ /g, " ");
      return;
    }
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const tag = el.tagName;
    if (tag === "BR") {
      out += "\n";
      return;
    }
    const block = BLOCKS.has(tag);
    if (block) line();
    if (tag === "LI") {
      const list = el.parentElement;
      if (list?.tagName === "OL") out += `${Number(list.getAttribute("start") ?? 1) + [...list.children].indexOf(el)}. `;
      else out += "• ";
    }
    if ((tag === "TD" || tag === "TH") && el.previousElementSibling) out += "\t";
    el.childNodes.forEach(walk);
    if (tag === "TD" || tag === "TH") out = out.replace(/\n+$/, "");
    if (block) line();
  };
  root.childNodes.forEach(walk);
  return out.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
