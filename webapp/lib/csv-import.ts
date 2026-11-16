// A Leads board from a CSV file (queue 572; the owner: Notion goes, and whoever kept leads there exports them as CSV): the
// file's columns are matched to the board's cells by name -- the board's own labels and keys, and the column names an
// older Leads board used -- and a column that matches nothing is reported, never guessed. Pure, so the tests read it.
// The import itself (app/api/local-board/import) writes as the person and never overwrites a filled cell.

/** One CSV text as rows of cells: quoted cells, doubled quotes, commas and newlines inside quotes, CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && s[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Column names an older Leads board used, to the board's keys (beyond each cell's own label and key). */
const ALIASES: Record<string, string> = {
  "business name": "business",
  name: "business",
  company: "business",
  "company size": "size",
  size: "size",
  email: "business_email",
  "business email": "business_email",
  "how can i help": "package",
  "how we can help": "package",
  whatsapp: "whatsapp",
  "whatsapp number": "whatsapp",
  "google map location": "map_link",
  "map link": "map_link",
  "draft whatsapp msg": "draft_whatsapp",
  "draft whatsapp": "draft_whatsapp",
  "linkedin found via": "linkedin_via",
  "founder linkedin": "founder_linkedin",
  "contact person": "contact_person",
  "founded by": "contact_person",
  "contact role": "contact_role",
  "found on": "source_pages",
  "source pages": "source_pages",
  "tools on site": "tools_on_site",
  "site health": "site_health",
  "lead score": "lead_score",
  "result date": "result_date",
  "sent by": "sent_by",
};
/** Columns read and left out on purpose (the board keeps no such cell). */
export const SKIPPED = new Set(["stage", "created time", "last edited time", "created by", "last edited by", "id"]);

/** Each CSV header to a board key, or null; and the headers that matched nothing (skipped ones are not reported). */
export function mapHeaders(headers: string[], fields: { key: string; label: string }[]): { map: (string | null)[]; unmatched: string[] } {
  const byName = new Map<string, string>();
  for (const f of fields) {
    byName.set(norm(f.label), f.key);
    byName.set(norm(f.key), f.key);
  }
  for (const [a, k] of Object.entries(ALIASES)) if (fields.some((f) => f.key === k)) byName.set(a, k);
  const used = new Set<string>();
  const unmatched: string[] = [];
  const map = headers.map((h) => {
    const n = norm(h);
    if (!n || SKIPPED.has(n)) return null;
    const k = byName.get(n);
    if (!k || used.has(k)) {
      unmatched.push(h.trim());
      return null;
    }
    used.add(k);
    return k;
  });
  return { map, unmatched };
}

/** The CSV's data rows as cells by board key (empty cells left out). */
export function csvRows(text: string, fields: { key: string; label: string }[]): { rows: Record<string, string>[]; unmatched: string[]; columns: number } {
  const all = parseCsv(text);
  if (!all.length) return { rows: [], unmatched: [], columns: 0 };
  const { map, unmatched } = mapHeaders(all[0], fields);
  const rows = all.slice(1).map((r) => {
    const out: Record<string, string> = {};
    r.forEach((v, i) => {
      const k = map[i];
      if (k && v.trim()) out[k] = v.trim();
    });
    return out;
  });
  return { rows: rows.filter((r) => Object.keys(r).length), unmatched, columns: map.filter(Boolean).length };
}
