// A PDF from lines of text (Helvetica, A4), with no dependency: enough for a weekly statement a person can save or
// forward. A long week (many days, many notes) runs onto further pages. Characters outside Latin-1 are replaced, since
// the built-in font cannot draw them.
export function textPdf(lines: { text: string; size?: number; bold?: boolean }[]): Uint8Array {
  const esc = (s: string) => s.replace(/[^\x20-\xff]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const TOP = 800;
  const BOTTOM = 56;
  const pages: string[][] = [["BT"]];
  let y = TOP;
  for (const l of lines) {
    const size = l.size ?? 11;
    if (y - (size + 7) < BOTTOM) {
      pages[pages.length - 1].push("ET");
      pages.push(["BT"]);
      y = TOP;
    }
    y -= size + 7;
    pages[pages.length - 1].push(`/${l.bold ? "F2" : "F1"} ${size} Tf 1 0 0 1 56 ${y} Tm (${esc(l.text)}) Tj`);
  }
  pages[pages.length - 1].push("ET");
  // Objects: 1 catalog, 2 pages, 3-4 fonts, then a page and its content stream for each page.
  const pageObj = (i: number) => 5 + i * 2;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  for (let i = 0; i < pages.length; i++) {
    const content = pages[i].join("\n");
    objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageObj(i) + 1} 0 R >>`);
    objs.push(`<< /Length ${Buffer.byteLength(content, "latin1")} >>\nstream\n${content}\nendstream`);
  }
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(Buffer.byteLength(out, "latin1"));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, "latin1");
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(out, "latin1"));
}
