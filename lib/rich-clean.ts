// The one gate for formatted text: what a person pastes is shown to the whole team, so only formatting passes. No
// script, no event handler, no picture or frame, no style that can load anything. Runs before a paste enters the page, again when
// it is saved, and again when it is read.
import sanitizeHtml from "sanitize-html";

const LENGTH = /^-?\d+(\.\d+)?(pt|px|em|rem|%)?$/;
const COLOR = /^(#[0-9a-f]{3,8}|rgba?\([\d\s,.%/]+\)|transparent|inherit|currentcolor|[a-z]{3,24})$/i;
const BORDER = /^(none|hidden|solid|dashed|dotted|double|\d+(\.\d+)?(pt|px)|#[0-9a-f]{3,8}|rgba?\([\d\s,.%/]+\)|[a-z]{3,24})(\s+(none|hidden|solid|dashed|dotted|double|\d+(\.\d+)?(pt|px)|#[0-9a-f]{3,8}|rgba?\([\d\s,.%/]+\)|[a-z]{3,24}))*$/i;
const SPACES = /^-?\d+(\.\d+)?(pt|px|em|rem|%)?(\s+-?\d+(\.\d+)?(pt|px|em|rem|%)?){0,3}$/;

const styles: Record<string, RegExp[]> = {
  color: [COLOR],
  "background-color": [COLOR],
  "font-family": [/^[\w\s,'"-]{1,160}$/],
  "font-size": [LENGTH],
  "font-weight": [/^(normal|bold|bolder|lighter|[1-9]00)$/],
  "font-style": [/^(normal|italic|oblique)$/],
  "font-variant": [/^(normal|small-caps)$/],
  "text-decoration": [/^(none|underline|line-through|overline)(\s+(underline|line-through|overline))*$/],
  "text-decoration-line": [/^(none|underline|line-through|overline)(\s+(underline|line-through|overline))*$/],
  "text-align": [/^(left|right|center|justify|start|end)$/],
  "text-indent": [LENGTH],
  "vertical-align": [/^(baseline|sub|super|top|middle|bottom|text-top|text-bottom)$/],
  "line-height": [/^(normal|\d+(\.\d+)?(pt|px|em|rem|%)?)$/],
  "letter-spacing": [/^(normal|-?\d+(\.\d+)?(pt|px|em))$/],
  "white-space": [/^(normal|pre|pre-wrap|pre-line|nowrap|break-spaces)$/],
  "list-style-type": [/^(none|disc|circle|square|decimal|lower-alpha|upper-alpha|lower-latin|upper-latin|lower-roman|upper-roman)$/],
  margin: [SPACES],
  "margin-top": [LENGTH],
  "margin-right": [LENGTH],
  "margin-bottom": [LENGTH],
  "margin-left": [LENGTH],
  padding: [SPACES],
  "padding-top": [LENGTH],
  "padding-right": [LENGTH],
  "padding-bottom": [LENGTH],
  "padding-left": [LENGTH],
  width: [LENGTH],
  border: [BORDER],
  "border-top": [BORDER],
  "border-right": [BORDER],
  "border-bottom": [BORDER],
  "border-left": [BORDER],
  "border-color": [BORDER],
  "border-style": [BORDER],
  "border-width": [BORDER],
  "border-collapse": [/^(collapse|separate)$/],
  "table-layout": [/^(auto|fixed)$/],
};

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: ["p", "div", "span", "b", "strong", "i", "em", "u", "s", "strike", "del", "sub", "sup", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code", "a", "table", "thead", "tbody", "tfoot", "tr", "td", "th", "colgroup", "col", "caption"],
  allowedAttributes: { "*": ["style", "dir"], a: ["href", "target", "rel"], ol: ["start"], td: ["colspan", "rowspan"], th: ["colspan", "rowspan"], col: ["span", "width"] },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowProtocolRelative: false,
  allowedStyles: { "*": styles },
  disallowedTagsMode: "discard",
  transformTags: { a: (tagName, attribs) => ({ tagName, attribs: { ...attribs, target: "_blank", rel: "noopener noreferrer" } }) },
};

export const cleanRich = (html: string) => sanitizeHtml(html, OPTIONS).trim();
