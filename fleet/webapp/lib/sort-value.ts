// How a table cell sorts (owner, 2026-11-12: every table sortable, now and in the future): numbers by value ("1,234",
// "91%", "$0.32", "#22", "3 h" all read as numbers), dates and words by their text, an empty or "–" cell always last.
// Pure, for app/sortable-table.tsx and its test.

export type SortValue = { num: number | null; text: string; empty: boolean };

const EMPTY = /^(|–|-|—|n\/a|never|none|no cap)$/i;

export function sortValue(raw: string | number | null | undefined): SortValue {
  if (typeof raw === "number") return { num: Number.isFinite(raw) ? raw : null, text: String(raw), empty: !Number.isFinite(raw) };
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (EMPTY.test(text)) return { num: null, text: "", empty: true };
  // an ISO date or time sorts as text (it already orders correctly); so does anything that is not mostly a number
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return { num: null, text, empty: false };
  const m = text.match(/^[#$€£~≈]?\s*(-?\d[\d,]*(?:\.\d+)?)\s*(%|k|m|[a-z]{1,3}\b)?/i);
  if (m) {
    let n = Number(m[1].replace(/,/g, ""));
    const unit = (m[2] ?? "").toLowerCase();
    if (unit === "k") n *= 1e3;
    else if (unit === "m" && !/\bmin/i.test(text)) n *= 1e6;
    else if (unit === "min") n *= 60;
    else if (unit === "h") n *= 3600;
    else if (unit === "d") n *= 86400;
    return { num: n, text, empty: false };
  }
  return { num: null, text: text.toLowerCase(), empty: false };
}

/** Ascending order of two cells; empties last in both directions (the caller flips only non-empty comparisons). */
export function compareValues(a: SortValue, b: SortValue): number {
  if (a.num !== null && b.num !== null) return a.num - b.num;
  if (a.num !== null) return -1;
  if (b.num !== null) return 1;
  return a.text.localeCompare(b.text, undefined, { numeric: true, sensitivity: "base" });
}

/** Indexes of the rows in their sorted order (stable: equal rows keep their order). */
export function sortOrder(values: SortValue[], dir: "asc" | "desc"): number[] {
  return values
    .map((v, i) => ({ v, i }))
    .sort((x, y) => {
      if (x.v.empty !== y.v.empty) return x.v.empty ? 1 : -1;
      const c = compareValues(x.v, y.v);
      return (dir === "asc" ? c : -c) || x.i - y.i;
    })
    .map((x) => x.i);
}
