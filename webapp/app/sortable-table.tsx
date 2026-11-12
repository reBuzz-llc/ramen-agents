"use client";
// Every table on the dashboard sorts (owner, 2026-11-12: "any table that we may have now, had or in future"): write
// <SortableTable> where a <table> would go, with its <thead> and <tbody> as children. A click on a heading sorts the
// rows by that column (again: the other way; a third time: the original order). React reorders the rows itself, so a
// table that refreshes keeps working. A cell sorts by its text (numbers, %, $ and dates read as such) unless it carries
// data-sort="<value>". A heading with data-nosort stays plain; rows of one group can be one <Fragment>. tests/tables.test.ts
// fails on a bare <table> anywhere under app/, so a new table cannot skip this.
import { Children, cloneElement, isValidElement, useState, type ReactElement, type ReactNode } from "react";
import { sortOrder, sortValue } from "@/lib/sort-value";

type El = ReactElement<{ children?: ReactNode; className?: string; "data-sort"?: string | number; "data-nosort"?: boolean }>;

/** The visible text of a rendered cell (strings and numbers in its tree), for sorting. */
function textOf(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  if (isValidElement(node)) return textOf((node as El).props.children);
  return "";
}

/** The cells of a row (a <tr>, or a Fragment whose first <tr> speaks for the group). */
function cellsOf(row: ReactNode): El[] {
  if (!isValidElement(row)) return [];
  const el = row as El;
  if (el.type === "tr") return Children.toArray(el.props.children).filter(isValidElement) as El[];
  const first = Children.toArray(el.props.children).find((c) => isValidElement(c) && (c as El).type === "tr");
  return first ? cellsOf(first) : [];
}

function cellValue(cell: El | undefined): string | number {
  if (!cell) return "";
  const v = cell.props["data-sort"];
  return v !== undefined ? v : textOf(cell.props.children);
}

export default function SortableTable({ children, className, ...rest }: { children: ReactNode; className?: string } & Record<string, unknown>) {
  const [sort, setSort] = useState<{ col: number; dir: "asc" | "desc" } | null>(null);
  const parts = Children.toArray(children).filter(isValidElement) as El[];

  const click = (col: number) =>
    setSort((s) => (!s || s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null));

  const head = (el: El) => {
    const rows = Children.toArray(el.props.children).filter(isValidElement) as El[];
    return cloneElement(el, {}, rows.map((tr, r) => {
      // only the last header row gets the buttons (a grouped header's top row stays as it is)
      if (r !== rows.length - 1) return tr;
      let col = -1;
      return cloneElement(tr, { key: tr.key ?? r }, (Children.toArray(tr.props.children).filter(isValidElement) as El[]).map((th, i) => {
        col += 1;
        const label = th.props.children;
        if (th.props["data-nosort"] || !textOf(label).trim()) return cloneElement(th, { key: th.key ?? i });
        const me = col;
        const on = sort?.col === me;
        return cloneElement(
          th,
          { key: th.key ?? i, "aria-sort": on ? (sort!.dir === "asc" ? "ascending" : "descending") : "none" } as Record<string, unknown>,
          <button type="button" onClick={() => click(me)} className="inline-flex items-center gap-1 text-inherit hover:text-ink focus-visible:underline" title="Sort by this column">
            {label}
            <span aria-hidden className={`text-[10px] ${on ? "text-ink" : "text-muted/60"}`}>{on ? (sort!.dir === "asc" ? "▲" : "▼") : "↕"}</span>
          </button>,
        );
      }));
    }));
  };

  const body = (el: El) => {
    if (!sort) return el;
    const rows = Children.toArray(el.props.children);
    const order = sortOrder(rows.map((r) => sortValue(cellValue(cellsOf(r)[sort.col]))), sort.dir);
    return cloneElement(el, {}, order.map((i) => rows[i]));
  };

  return (
    <table className={className} {...rest}>
      {parts.map((p) => (p.type === "thead" ? head(p) : p.type === "tbody" ? body(p) : p))}
    </table>
  );
}
