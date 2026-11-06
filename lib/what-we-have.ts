// The "What we have" sections' light markdown, the shape examples/company.md is written in: "### Title" opens a toggle
// (closed until clicked) that runs to the next one; "- ", "* " or "1. " is a list item, two spaces of indent a level deeper; any other
// line is a paragraph. Links are written as plain URLs.

export type ListItem = { text: string; children: ListBlock[] };
export type ListBlock = { kind: "list"; ordered: boolean; items: ListItem[] };
export type Block = { kind: "p"; text: string } | ListBlock | { kind: "toggle"; title: string; children: Block[] };

const ITEM = /^(\s*)(?:([-*])|(\d+)[.)])\s+(.*)$/;
const BARE_ITEM = /^(\s*)(?:[-*]|\d+[.)])\s*$/; // a list item left empty ("6.")

/** The flat blocks of a run of lines with no toggles: paragraphs and nested lists. */
function flat(lines: string[]): Block[] {
  const out: Block[] = [];
  // the open lists, one per level: [indent, list]
  let stack: { indent: number; list: ListBlock }[] = [];
  for (const raw of lines) {
    if (!raw.trim() || BARE_ITEM.test(raw)) continue;
    const m = ITEM.exec(raw);
    if (!m) {
      stack = [];
      out.push({ kind: "p", text: raw.trim() });
      continue;
    }
    const indent = m[1].replace(/\t/g, "  ").length;
    const ordered = !!m[3];
    const item: ListItem = { text: m[4].trim(), children: [] };
    while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
    const top = stack[stack.length - 1];
    if (top && top.indent === indent && top.list.ordered === ordered) {
      top.list.items.push(item);
    } else if (top && top.indent === indent) {
      // the same level, the other kind of list: a new list beside it
      stack.pop();
      const list: ListBlock = { kind: "list", ordered, items: [item] };
      const parent = stack[stack.length - 1];
      if (parent) parent.list.items[parent.list.items.length - 1].children.push(list);
      else out.push(list);
      stack.push({ indent, list });
    } else {
      const list: ListBlock = { kind: "list", ordered, items: [item] };
      if (top) top.list.items[top.list.items.length - 1].children.push(list);
      else out.push(list);
      stack.push({ indent, list });
    }
  }
  return out;
}

/** A section's body as blocks. */
export function parseBody(body: string): Block[] {
  const lines = body.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let run: string[] = [];
  let toggle: { title: string; lines: string[] } | null = null;
  const close = () => {
    if (toggle) out.push({ kind: "toggle", title: toggle.title, children: flat(toggle.lines) });
    else out.push(...flat(run));
    run = [];
    toggle = null;
  };
  for (const line of lines) {
    const h = /^#{3,6}\s+(.*)$/.exec(line.trim());
    if (h) {
      close();
      toggle = { title: h[1].trim(), lines: [] };
    } else if (toggle) toggle.lines.push(line);
    else run.push(line);
  }
  close();
  return out;
}

/** Text split into plain runs and links (http(s) URLs; a trailing comma or full stop is left outside). */
export function linkify(text: string): { text: string; href?: string }[] {
  const out: { text: string; href?: string }[] = [];
  const re = /https?:\/\/[^\s<>"')]+/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    let url = m[0];
    while (/[.,;:!?]$/.test(url)) url = url.slice(0, -1);
    const i = m.index ?? 0;
    if (i > at) out.push({ text: text.slice(at, i) });
    out.push({ text: url, href: url });
    at = i + url.length;
  }
  if (at < text.length) out.push({ text: text.slice(at) });
  return out;
}
