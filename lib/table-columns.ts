// The Leads table's column menu, wrap and width. A person's choices are kept on the person
// (users.view_prefs), so they follow them across reloads and devices. Pure, tested.

export const COLUMN_WIDTH = { min: 64, wrapped: 240, max: 960 };
const MAX_COLUMNS = 60;

export type ColumnPref = { w?: number; wrap?: boolean };
export type TableColumns = Record<string, ColumnPref>;

export const clampColumn = (w: number) => Math.round(Math.min(COLUMN_WIDTH.max, Math.max(COLUMN_WIDTH.min, w)));

/** Whatever is stored or sent, as a tidy map: known shapes only, widths inside the limits, nothing kept for a default column. */
export function tableColumnsOf(raw: unknown): TableColumns {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: TableColumns = {};
  for (const [k, v] of Object.entries(raw).slice(0, MAX_COLUMNS)) {
    if (!/^[a-zA-Z]{1,40}$/.test(k) || !v || typeof v !== "object") continue;
    const p = v as Record<string, unknown>;
    const one: ColumnPref = {};
    if (typeof p.w === "number" && Number.isFinite(p.w)) one.w = clampColumn(p.w);
    if (p.wrap === true) one.wrap = true;
    if (one.w !== undefined || one.wrap) out[k] = one;
  }
  return out;
}

/** The width a column is held at, or null when it sizes to its content. A wrapped column needs one, or it would not wrap. */
export const columnWidth = (p: ColumnPref | undefined): number | null => p?.w ?? (p?.wrap ? COLUMN_WIDTH.wrapped : null);

const tidy = (cols: TableColumns, key: string, p: ColumnPref): TableColumns => {
  const { [key]: _old, ...rest } = cols;
  void _old;
  return p.w !== undefined || p.wrap ? { ...rest, [key]: p } : rest;
};

export function withWidth(cols: TableColumns, key: string, w: number | null): TableColumns {
  const { w: _w, ...keep } = cols[key] ?? {};
  void _w;
  return tidy(cols, key, w === null ? keep : { ...keep, w: clampColumn(w) });
}

export function withWrap(cols: TableColumns, key: string, on: boolean): TableColumns {
  const { wrap: _wrap, ...keep } = cols[key] ?? {};
  void _wrap;
  return tidy(cols, key, on ? { ...keep, wrap: true } : keep);
}

export type MenuAction = "sort-asc" | "sort-desc" | "sort-clear" | "wrap" | "width-reset";
export type MenuItem = { action: MenuAction; label: string; checked?: boolean; divider?: boolean };

/** A column's menu, as a list, so a later entry is one more line here. */
export function columnMenu(c: { dir: 1 | -1 | 0; order: [string, string]; canWrap: boolean; wrap: boolean; hasWidth: boolean }): MenuItem[] {
  const items: MenuItem[] = [
    { action: "sort-asc", label: `Sort ${c.order[0]}`, checked: c.dir === 1 },
    { action: "sort-desc", label: `Sort ${c.order[1]}`, checked: c.dir === -1 },
  ];
  if (c.dir) items.push({ action: "sort-clear", label: "Clear sort" });
  if (c.canWrap) items.push({ action: "wrap", label: "Wrap text", checked: c.wrap, divider: true });
  if (c.hasWidth) items.push({ action: "width-reset", label: "Reset width", divider: !c.canWrap });
  return items;
}

/** The Table carries only the start of a long cell (160 characters, a draft's 120): at that length there is more in the lead. */
export const isCutCell = (key: string, text: string) => text.length >= (key.startsWith("draft") ? 120 : 160);

/** A column's key as the lead's field: painPoint is pain_point. */
export const fieldOfColumn = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
