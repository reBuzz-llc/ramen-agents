// "Just enough markdown" for the Validator's reports (headings, one or more tables, bullet lists, paragraphs), as the
// Family review drew them; now the Reports page under Settings. Pure, so the test reads fixtures.

export type Block =
  | { kind: "h1" | "h2" | "p" | "li"; text: string }
  | { kind: "table"; head: string[]; rows: string[][] };

export function parseReport(md: string): Block[] {
  const out: Block[] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        if (!/^\|[\s:|-]+\|$/.test(lines[i])) rows.push(lines[i].split("|").slice(1, -1).map((c) => c.trim()));
        i++;
      }
      i--;
      const [head = [], ...body] = rows;
      out.push({ kind: "table", head, rows: body });
    } else if (l.startsWith("# ")) out.push({ kind: "h1", text: l.slice(2) });
    else if (l.startsWith("## ") || l.startsWith("### ")) out.push({ kind: "h2", text: l.replace(/^#+ /, "") });
    else if (/^\s*[-*] /.test(l)) out.push({ kind: "li", text: l.replace(/^\s*[-*] /, "") });
    else if (l.trim()) out.push({ kind: "p", text: l });
  }
  return out;
}
