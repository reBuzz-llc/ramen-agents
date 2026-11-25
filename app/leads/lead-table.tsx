"use client";
// The Table tab (a table view, like in Notion): every cell of every lead
// as a grid, one line per lead. Click a header for its menu: sort, wrap; drag a header's edge to resize it;
// the business stays in view while the grid scrolls sideways, the headers while it scrolls down. A row opens the same
// drawer as the Board, where cells are edited. Long text shows its first line; the full cell is in the drawer.
import { useEffect, useMemo, useRef, useState } from "react";
import { agentName } from "@/lib/agent-names";
import { telHref } from "@/lib/phone";
import { siteHealthShort } from "@/lib/site-health-short";
import { clampColumn, COLUMN_WIDTH, columnMenu, columnWidth, fieldOfColumn, isCutCell, withWidth, withWrap, type MenuAction, type TableColumns } from "@/lib/table-columns";
import ColumnMenu, { FullCell } from "./column-menu";
import { Chip } from "./chip";
import type { BoardRow } from "./leads-view";

export type TableRow = BoardRow & {
  location?: string | null;
  businessEmail?: string | null;
  emailCheck?: string | null;
  size?: string | null;
  founderLinkedin?: string | null;
  linkedinVia?: string | null;
  whatsapp?: string | null;
  phone?: string | null;
  mapLink?: string | null;
  painPoint?: string | null;
  draftEmail?: string | null;
  draftWhatsapp?: string | null;
  evidence?: string | null;
  sourcePages?: string | null;
  toolsOnSite?: string[] | null;
  siteHealth?: string | null;
  resultDate?: string | null;
  sentAt?: string | null;
  foundBy?: string | null;
  notes?: string | null;
  createdAt?: string;
};

type Kind = "text" | "long" | "link" | "status" | "number" | "date" | "phone";
type Col = {
  key: string;
  label: string;
  kind: Kind;
  get: (r: TableRow) => string | number | null;
};

const join = (v: string[] | null | undefined) =>
  v?.length ? v.join(", ") : null;
const day = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);

/** The columns in the drawer's order, after the header block's (business, website, location, industry). */
export const COLUMNS: Col[] = [
  { key: "website", label: "Website", kind: "link", get: (r) => r.website },
  {
    key: "location",
    label: "Location",
    kind: "text",
    get: (r) =>
      r.location ?? ([r.city, r.state].filter(Boolean).join(", ") || null),
  },
  { key: "industry", label: "Industry", kind: "text", get: (r) => r.industry },
  {
    key: "emailStatus",
    label: "Email status",
    kind: "status",
    get: (r) => r.emailStatus,
  },
  {
    key: "whatsappStatus",
    label: "WhatsApp status",
    kind: "status",
    get: (r) => r.whatsappStatus,
  },
  { key: "result", label: "Result", kind: "status", get: (r) => r.result },
  {
    key: "leadScore",
    label: "Lead score",
    kind: "number",
    get: (r) => r.leadScore,
  },
  { key: "takenBy", label: "Taken by", kind: "text", get: (r) => r.takenBy },
  {
    key: "contactPerson",
    label: "Contact person",
    kind: "text",
    get: (r) => r.contactPerson,
  },
  {
    key: "contactRole",
    label: "Contact role",
    kind: "text",
    get: (r) => r.contactRole,
  },
  {
    key: "founderLinkedin",
    label: "Founder LinkedIn",
    kind: "link",
    get: (r) => r.founderLinkedin ?? null,
  },
  {
    key: "linkedinVia",
    label: "LinkedIn found via",
    kind: "text",
    get: (r) => r.linkedinVia ?? null,
  },
  {
    key: "businessEmail",
    label: "Business email",
    kind: "text",
    get: (r) => r.businessEmail ?? null,
  },
  {
    key: "emailCheck",
    label: "Email check",
    kind: "text",
    get: (r) => r.emailCheck ?? null,
  },
  {
    key: "whatsapp",
    label: "WhatsApp",
    kind: "text",
    get: (r) => r.whatsapp ?? null,
  },
  { key: "phone", label: "Phone", kind: "phone", get: (r) => r.phone ?? null },
  {
    key: "painPoint",
    label: "Pain point",
    kind: "long",
    get: (r) => r.painPoint ?? null,
  },
  {
    key: "draftEmail",
    label: "Draft email",
    kind: "long",
    get: (r) => r.draftEmail ?? null,
  },
  {
    key: "draftWhatsapp",
    label: "Draft WhatsApp message",
    kind: "long",
    get: (r) => r.draftWhatsapp ?? null,
  },
  {
    key: "size",
    label: "Company size",
    kind: "text",
    get: (r) => r.size ?? null,
  },
  {
    key: "package",
    label: "How can I help",
    kind: "text",
    get: (r) => r.package,
  },
  { key: "mapLink", label: "Map", kind: "link", get: (r) => r.mapLink ?? null },
  {
    key: "evidence",
    label: "Evidence",
    kind: "long",
    get: (r) => r.evidence ?? null,
  },
  {
    key: "sourcePages",
    label: "Source pages",
    kind: "long",
    get: (r) => r.sourcePages ?? null,
  },
  {
    key: "toolsOnSite",
    label: "Tools on site",
    kind: "text",
    get: (r) => join(r.toolsOnSite),
  },
  {
    key: "siteHealth",
    label: "Site health",
    kind: "long",
    // the year and the load time; the stored text is untouched
    get: (r) => siteHealthShort(r.siteHealth) || null,
  },
  {
    key: "resultDate",
    label: "Result date",
    kind: "date",
    get: (r) => day(r.resultDate),
  },
  { key: "sentBy", label: "Sent by", kind: "text", get: (r) => join(r.sentBy) },
  { key: "sentAt", label: "Sent at", kind: "date", get: (r) => day(r.sentAt) },
  {
    key: "foundBy",
    label: "Found by",
    kind: "text",
    get: (r) => (r.foundBy ? agentName(r.foundBy) : null),
  },
  { key: "notes", label: "Notes", kind: "long", get: (r) => r.notes ?? null },
  {
    key: "createdAt",
    label: "Created",
    kind: "date",
    get: (r) => day(r.createdAt),
  },
  {
    key: "updatedAt",
    label: "Last edited",
    kind: "date",
    get: (r) => day(r.updatedAt),
  },
];

type Sort = { key: string; dir: 1 | -1 } | null;

/** A person's column arrangement: the order of the columns and the ones hidden. Business stays first and shown. */
export type Arrangement = { order: string[]; hidden: string[] };
export const STORE = "peek-leads-table-columns";

/** The columns in a saved arrangement's order: names no longer on the board are dropped, columns added since go at
 *  the end, hidden ones are left out. */
export function arrange(saved: Arrangement | null): Col[] {
  const byKey = new Map(COLUMNS.map((c) => [c.key, c]));
  const order = [
    ...(saved?.order ?? []).filter((k) => byKey.has(k)),
    ...COLUMNS.map((c) => c.key).filter((k) => !saved?.order.includes(k)),
  ];
  const hidden = new Set(saved?.hidden ?? []);
  return [...new Set(order)]
    .filter((k) => !hidden.has(k))
    .map((k) => byKey.get(k)!);
}

/** Moves column `from` to where `to` is (before it when moving left, after it when moving right). */
export function moveKey(order: string[], from: string, to: string): string[] {
  const i = order.indexOf(from);
  const j = order.indexOf(to);
  if (i < 0 || j < 0 || i === j) return order;
  const out = order.filter((k) => k !== from);
  out.splice(j, 0, from);
  return out;
}

const fullOrder = (a: Arrangement | null) => {
  const known = COLUMNS.map((c) => c.key);
  return [
    ...new Set([
      ...(a?.order ?? []).filter((k) => known.includes(k)),
      ...known,
    ]),
  ];
};

/** How each kind of column reads when sorted one way and the other. */
const ORDER: Record<Kind, [string, string]> = {
  text: ["A to Z", "Z to A"],
  long: ["A to Z", "Z to A"],
  link: ["A to Z", "Z to A"],
  status: ["A to Z", "Z to A"],
  number: ["low to high", "high to low"],
  date: ["oldest first", "newest first"],
  phone: ["low to high", "high to low"],
};
const kind = (key: string): Kind =>
  COLUMNS.find((c) => c.key === key)?.kind ?? "text";

/** Rows in a column's order. An empty cell counts as the highest value: at the bottom in the first
 *  order (A to Z, low to high, oldest first), at the top in the reverse one, so a second click on Website lists the
 *  leads with no website first. The business sorts by name; no sort keeps the board's. */
export function sortRows(rows: TableRow[], sort: Sort): TableRow[] {
  if (!sort) return rows;
  const get =
    sort.key === "business"
      ? (r: TableRow) => r.business
      : (COLUMNS.find((c) => c.key === sort.key)?.get ?? (() => null));
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    const ex = x === null || x === "";
    const ey = y === null || y === "";
    if (ex || ey) return ex && ey ? 0 : (ex ? 1 : -1) * sort.dir;
    const c =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), undefined, {
            numeric: true,
            sensitivity: "base",
          });
    return c * sort.dir;
  });
}

const WIDTH: Record<Kind, string> = {
  text: "max-w-56",
  long: "max-w-80",
  link: "max-w-56",
  status: "",
  number: "",
  date: "",
  phone: "",
};

const WRAPS: Kind[] = ["text", "long", "link"];

function Cell({ col, row, wrapped, sized }: { col: Col; row: TableRow; wrapped: boolean; sized: boolean }) {
  const v = col.get(row);
  if (v === null || v === "") return <span className="text-muted">–</span>;
  if (col.kind === "status") return <Chip status={String(v)} />;
  const text = String(v);
  const tel = col.kind === "phone" ? telHref(text) : null;
  if (tel)
    return (
      <a
        href={tel}
        onClick={(e) => e.stopPropagation()}
        className="text-accent-ink tabular-nums hover:underline"
      >
        {text}
      </a>
    );
  if (col.kind === "link" && /^https?:\/\//.test(text))
    return (
      <a
        href={text}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={text}
        className={`text-accent-ink hover:underline ${wrapped ? "line-clamp-3 break-all whitespace-normal" : `block truncate ${sized ? "" : WIDTH.link}`}`}
      >
        {text.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
      </a>
    );
  // up to three lines, ending in "…"; a click on one with more shows all of it
  if (wrapped)
    return (
      <span data-wrap-text={col.key} className="line-clamp-3 break-words whitespace-pre-line">
        {text}
        {col.kind === "long" && isCutCell(col.key, text) ? "…" : ""}
      </span>
    );
  return (
    <span
      title={text.length > 40 ? text : undefined}
      className={`block truncate ${sized ? "" : WIDTH[col.kind]}`}
    >
      {col.kind === "long" ? text.split("\n")[0] : text}
    </span>
  );
}

export default function LeadTable({
  rows,
  onOpen,
  onOrder,
  columnPrefs,
}: {
  rows: TableRow[];
  onOpen: (id: string) => void;
  /** The rows as sorted on screen, for the lead panel's up and down arrows. */
  onOrder?: (ids: string[]) => void;
  /** This person's wrap and width per column. */
  columnPrefs?: TableColumns;
}) {
  const [sort, setSort] = useState<Sort>(null);
  // how many rows are drawn, so a person can see more: 500 at a time, or all
  const [limit, setLimit] = useState(500);
  // The arrangement lives in this browser (localStorage), read after the first render so the server's HTML matches.
  const [arr, setArr] = useState<Arrangement | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [panel, setPanel] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORE);
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the browser after hydration
      if (raw) setArr(JSON.parse(raw) as Arrangement);
    } catch {
      /* no storage: the default arrangement */
    }
  }, []);
  const save = (a: Arrangement | null) => {
    setArr(a);
    try {
      if (a) localStorage.setItem(STORE, JSON.stringify(a));
      else localStorage.removeItem(STORE);
    } catch {
      /* kept for this visit only */
    }
  };
  const cols = useMemo(() => arrange(arr), [arr]);
  const order = fullOrder(arr);
  const hidden = arr?.hidden ?? [];
  const move = (from: string, to: string) =>
    save({ order: moveKey(order, from, to), hidden });
  const sorted = useMemo(() => sortRows(rows, sort), [rows, sort]);
  useEffect(() => onOrder?.(sorted.map((r) => r.id)), [sorted, onOrder]);
  // the heading's menu, wrap and width, kept on the person
  const [columns, setColumns] = useState<TableColumns>(columnPrefs ?? {});
  const columnsNow = useRef<TableColumns>(columnPrefs ?? {});
  const [menu, setMenu] = useState<{ key: string; label: string; x: number; y: number } | null>(null);
  const [full, setFull] = useState<{ id: string; text: string; x: number; y: number } | null>(null);
  const table = useRef<HTMLTableElement>(null);
  const resize = useRef<{ key: string; x: number; from: number; w: number; before: TableColumns } | null>(null);
  const closeMenu = () => setMenu(null);
  const closeFull = () => setFull(null);
  const holdColumns = (next: TableColumns) => {
    columnsNow.current = next;
    setColumns(next);
  };
  const saveColumns = (next: TableColumns) => {
    holdColumns(next);
    void fetch("/api/view-prefs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ table_columns: next }) }).catch(() => undefined);
  };
  const pick = (key: string, a: MenuAction) => {
    setMenu(null);
    if (a === "sort-asc") setSort({ key, dir: 1 });
    else if (a === "sort-desc") setSort({ key, dir: -1 });
    else if (a === "sort-clear") setSort(null);
    else if (a === "wrap") saveColumns(withWrap(columnsNow.current, key, !columnsNow.current[key]?.wrap));
    else saveColumns(withWidth(columnsNow.current, key, null));
  };
  // the width follows the pointer through one CSS variable, so a drag does not redraw thousands of cells
  const startResize = (e: React.PointerEvent<HTMLButtonElement>, key: string) => {
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    const from = e.currentTarget.closest("th")?.getBoundingClientRect().width ?? COLUMN_WIDTH.wrapped;
    resize.current = { key, x: e.clientX, from, w: clampColumn(from), before: columnsNow.current };
    holdColumns(withWidth(columnsNow.current, key, from));
  };
  const moveResize = (e: React.PointerEvent) => {
    const d = resize.current;
    if (!d) return;
    d.w = clampColumn(d.from + e.clientX - d.x);
    table.current?.style.setProperty(`--col-${d.key}`, `${d.w}px`);
  };
  const endResize = (e: React.PointerEvent) => {
    const d = resize.current;
    if (!d) return;
    resize.current = null;
    // a press with no drag changes nothing
    if (Math.abs(e.clientX - d.x) < 2) holdColumns(d.before);
    else saveColumns(withWidth(d.before, d.key, d.w));
  };
  const tableVars = useMemo(() => Object.fromEntries(Object.entries(columns).map(([k, p]) => [`--col-${k}`, `${columnWidth(p)}px`])) as React.CSSProperties, [columns]);
  const sizeOf = (k: string): React.CSSProperties | undefined => (columnWidth(columns[k]) ? { width: `var(--col-${k})`, minWidth: `var(--col-${k})`, maxWidth: `var(--col-${k})` } : undefined);
  // a click on a wrapped cell with more than it shows opens the whole text; any other click opens the lead
  const rowClick = (e: React.MouseEvent, id: string) => {
    const el = (e.target as Element).closest?.<HTMLElement>("[data-wrap-text]");
    const text = el?.textContent ?? "";
    const key = el?.dataset.wrapText ?? "";
    const cut = !!el && text.endsWith("…") && isCutCell(key, text.slice(0, -1));
    if (!el || !(cut || el.scrollHeight > el.clientHeight + 1)) return onOpen(id);
    const at = el.getBoundingClientRect();
    setFull({ id, text: cut ? text.slice(0, -1) : text, x: at.left, y: at.bottom + 4 });
    if (!cut) return;
    void fetch(`/api/leads/${id}`)
      .then((r) => (r.ok ? (r.json() as Promise<{ lead: Record<string, unknown> }>) : null))
      .then((d) => {
        const v = d?.lead?.[fieldOfColumn(key)];
        const whole = Array.isArray(v) ? v.join(", ") : typeof v === "string" ? v : "";
        if (whole) setFull((f) => (f?.id === id ? { ...f, text: whole } : f));
      })
      .catch(() => undefined);
  };
  const aria = (key: string) =>
    sort?.key === key
      ? sort.dir === 1
        ? "ascending"
        : "descending"
      : undefined;
  const head = (k: string, label: string, className = "") => (
    <th
      key={k}
      scope="col"
      aria-sort={aria(k)}
      style={sizeOf(k)}
      draggable={k !== "business"}
      onDragStart={(e) => {
        if (resize.current) return e.preventDefault(); // dragging the edge resizes; it does not move the column
        setMenu(null);
        setDragging(k);
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", k);
      }}
      onDragOver={(e) => {
        if (!dragging || k === "business") return;
        e.preventDefault();
        setOver(k);
      }}
      onDragLeave={() => setOver((o) => (o === k ? null : o))}
      onDrop={(e) => {
        e.preventDefault();
        if (dragging && k !== "business") move(dragging, k);
        setDragging(null);
        setOver(null);
      }}
      onDragEnd={() => {
        setDragging(null);
        setOver(null);
      }}
      className={`sticky top-0 z-10 border-b border-line bg-panel p-0 text-left font-normal ${k !== "business" ? "cursor-grab active:cursor-grabbing" : ""} ${dragging === k ? "opacity-50" : ""} ${over === k && dragging !== k ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""} ${className}`}
    >
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menu?.key === k}
        onClick={(e) => {
          const at = e.currentTarget.getBoundingClientRect();
          setMenu((m) => (m?.key === k ? null : { key: k, label, x: at.left, y: at.bottom }));
        }}
        data-column-head={k}
        title={
          k === "business"
            ? `${label}: sort and wrap`
            : `${label}: sort and wrap; drag to move the column`
        }
        className={`group/sort inline-flex min-h-11 w-full items-center gap-1.5 px-3 whitespace-nowrap hover:bg-bg hover:text-ink ${sort?.key === k ? "font-semibold text-ink" : ""}`}
      >
        <span className="min-w-0 truncate">{label}</span>
        <SortIcon dir={sort?.key === k ? sort.dir : 0} />
      </button>
      {/* desktop only: on a phone the column keeps its own width */}
      <button
        type="button"
        draggable={false}
        aria-label={`Resize ${label}: drag, or use the arrow keys; double-click for the default`}
        title="Drag to resize · double-click for the default width"
        data-column-resize={k}
        onPointerDown={(e) => startResize(e, k)}
        onPointerMove={moveResize}
        onPointerUp={endResize}
        onPointerCancel={endResize}
        onDoubleClick={() => saveColumns(withWidth(columnsNow.current, k, null))}
        onKeyDown={(e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const from = e.currentTarget.closest("th")?.getBoundingClientRect().width ?? COLUMN_WIDTH.wrapped;
          saveColumns(withWidth(columnsNow.current, k, from + (e.key === "ArrowRight" ? 16 : -16)));
        }}
        className="absolute inset-y-0 right-0 z-10 hidden w-2 cursor-col-resize touch-none hover:bg-accent/50 focus-visible:bg-accent md:block"
      />
    </th>
  );
  // how many leads have the sorted column empty: the note says where they are
  const emptyCount = useMemo(() => {
    if (!sort || sort.key === "business") return 0;
    const get = COLUMNS.find((c) => c.key === sort.key)?.get;
    return get ? rows.filter((r) => { const v = get(r); return v === null || v === ""; }).length : 0;
  }, [rows, sort]);
  const sortedBy = sort
    ? sort.key === "business"
      ? "Business"
      : COLUMNS.find((c) => c.key === sort.key)?.label
    : null;
  return (
    <>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-x-4">
        <p
          className="flex min-h-11 flex-wrap items-center gap-x-3 text-sm text-muted"
          aria-live="polite"
        >
          {sortedBy && sort ? (
            <>
              <span>
                Sorted by{" "}
                <span className="font-semibold text-ink">{sortedBy}</span>,{" "}
                {ORDER[kind(sort.key)][sort.dir === 1 ? 0 : 1]}
                {emptyCount ? (
                  <>
                    {" "}
                    · {emptyCount.toLocaleString()} with no {sortedBy}: {sort.dir === -1 ? "shown first" : `at the end (${ORDER[kind(sort.key)][1]} shows them first)`}
                  </>
                ) : null}
              </span>
              <button
                type="button"
                onClick={() => setSort(null)}
                className="inline-flex min-h-11 items-center text-accent-ink hover:underline"
              >
                Clear sort
              </button>
            </>
          ) : (
            <span>
              Click a heading to sort or wrap it. Drag its edge to resize it,
              and the heading itself to move it, or use Columns.
            </span>
          )}
        </p>
        <div className="relative">
          <button
            type="button"
            aria-expanded={panel}
            aria-controls="table-columns"
            onClick={() => setPanel(!panel)}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold ${panel ? "border-accent bg-accent-tint" : "border-line bg-panel hover:border-accent"}`}
          >
            Columns
            {hidden.length ? (
              <span className="text-xs font-normal text-muted">
                {hidden.length} hidden
              </span>
            ) : null}
          </button>
          {panel ? (
            <ColumnsPanel
              order={order}
              hidden={hidden}
              changed={!!arr}
              onChange={(o, h) => save({ order: o, hidden: h })}
              onReset={() => save(null)}
              onClose={() => setPanel(false)}
            />
          ) : null}
        </div>
      </div>
      <div
        onScroll={() => {
          setMenu(null);
          setFull(null);
        }}
        className="relative max-h-[calc(100dvh-10rem)] overflow-auto rounded-xl border border-line bg-panel"
      >
        <table ref={table} style={tableVars} className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">
            Every lead with every cell; a header opens its menu, a row opens the lead.
          </caption>
          <thead className="text-xs text-muted">
            <tr>
              {head("business", "Business", "left-0 z-20 border-r")}
              {cols.map((c) =>
                head(c.key, c.label, c.kind === "number" ? "text-right" : ""),
              )}
            </tr>
          </thead>
          <tbody>
            {sorted.slice(0, limit).map((r, i) => (
              <tr
                key={r.id}
                data-lead={r.id}
                onClick={(e) => rowClick(e, r.id)}
                className="group cursor-pointer"
              >
                <th
                  scope="row"
                  style={sizeOf("business")}
                  className={`sticky left-0 z-[5] border-r border-b border-line bg-panel px-3 py-2 text-left font-medium group-hover:bg-[color-mix(in_srgb,var(--color-accent)_14%,var(--color-panel))] ${columnWidth(columns.business) ? "" : "max-w-64"}`}
                >
                  {/* the row's number in the order shown (to know which row you are on under a sort) */}
                  <span className="flex items-baseline gap-2">
                    <span className="w-10 shrink-0 text-right text-xs font-normal text-muted tabular-nums">{i + 1}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpen(r.id);
                      }}
                      className={`min-w-0 text-left hover:underline ${columns.business?.wrap ? "line-clamp-3 break-words whitespace-normal" : `block truncate ${columnWidth(columns.business) ? "" : "max-w-52"}`}`}
                      title={r.business}
                    >
                      {r.business}
                    </button>
                  </span>
                </th>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    style={sizeOf(c.key)}
                    className={`overflow-hidden border-b border-line px-3 py-2 align-top whitespace-nowrap group-hover:bg-accent-tint ${c.kind === "number" ? "text-right tabular-nums" : ""}`}
                  >
                    <Cell col={c} row={r} wrapped={!!columns[c.key]?.wrap && WRAPS.includes(c.kind)} sized={!!columnWidth(columns[c.key])} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > limit ? (
          <div className="sticky left-0 flex flex-wrap items-center gap-3 p-3 text-sm">
            <span className="text-muted">
              Showing rows 1 to {limit.toLocaleString()} of {sorted.length.toLocaleString()}.
            </span>
            <button type="button" onClick={() => setLimit((n) => n + 500)} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 font-semibold hover:border-accent">
              Show {Math.min(500, sorted.length - limit).toLocaleString()} more
            </button>
            <button type="button" onClick={() => setLimit(sorted.length)} className="inline-flex min-h-11 items-center px-2 text-accent-ink hover:underline">
              Show all {sorted.length.toLocaleString()} (may take a few seconds)
            </button>
          </div>
        ) : sorted.length > 500 ? (
          <p className="sticky left-0 p-3 text-xs text-muted">All {sorted.length.toLocaleString()} rows shown.</p>
        ) : null}
      </div>
      {menu ? (
        <ColumnMenu
          label={menu.label}
          x={menu.x}
          y={menu.y}
          items={columnMenu({ dir: sort?.key === menu.key ? sort.dir : 0, order: ORDER[kind(menu.key)], canWrap: WRAPS.includes(kind(menu.key)), wrap: !!columns[menu.key]?.wrap, hasWidth: columns[menu.key]?.w !== undefined })}
          onPick={(a) => pick(menu.key, a)}
          onClose={closeMenu}
        />
      ) : null}
      {full ? (
        <FullCell
          x={full.x}
          y={full.y}
          onClose={closeFull}
          onOpen={() => {
            const id = full.id;
            setFull(null);
            onOpen(id);
          }}
        >
          {full.text}
        </FullCell>
      ) : null}
    </>
  );
}

/** Up and down chevrons on every heading: both faint until the column is sorted, then the one for its direction in
 *  the brand orange. */
function SortIcon({ dir }: { dir: 1 | -1 | 0 }) {
  const on = "text-accent-ink";
  const off = dir ? "opacity-25" : "opacity-40 group-hover/sort:opacity-80";
  return (
    <svg
      width={10}
      height={14}
      viewBox="0 0 10 14"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className="shrink-0"
    >
      <path d="M2 5l3-3 3 3" className={dir === 1 ? on : off} />
      <path d="M2 9l3 3 3-3" className={dir === -1 ? on : off} />
    </svg>
  );
}

/** The Columns panel: each column with a checkbox to show it and buttons to move it up or down (left or right in the
 *  grid), for phones and keyboards where dragging a heading is not an option; and Reset to the board's order. */
function ColumnsPanel({
  order,
  hidden,
  changed,
  onChange,
  onReset,
  onClose,
}: {
  order: string[];
  hidden: string[];
  changed: boolean;
  onChange: (order: string[], hidden: string[]) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  const label = (k: string) => COLUMNS.find((c) => c.key === k)?.label ?? k;
  const shift = (i: number, by: -1 | 1) => {
    const o = [...order];
    [o[i], o[i + by]] = [o[i + by]!, o[i]!];
    onChange(o, hidden);
  };
  return (
    <div
      id="table-columns"
      role="dialog"
      aria-label="Columns"
      className="absolute left-0 z-30 mt-2 w-80 sm:right-0 sm:left-auto max-w-[calc(100vw-2.5rem)] rounded-2xl border border-line bg-panel p-2 shadow-xl"
    >
      <div className="flex items-center justify-between px-2 py-1">
        <p className="text-sm font-semibold">Columns</p>
        <div className="flex items-center gap-1">
          {changed ? (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex min-h-11 items-center px-2 text-sm text-accent-ink hover:underline"
            >
              Reset
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 items-center px-2 text-sm hover:underline"
          >
            Done
          </button>
        </div>
      </div>
      <p className="px-2 pb-2 text-xs text-muted">
        Business stays first. Kept in this browser.
      </p>
      <ul className="max-h-[60dvh] overflow-y-auto">
        {order.map((k, i) => {
          const shown = !hidden.includes(k);
          return (
            <li
              key={k}
              className="flex items-center gap-1 rounded-xl px-1 hover:bg-bg"
            >
              <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-2 px-1 text-sm">
                <input
                  type="checkbox"
                  checked={shown}
                  onChange={() =>
                    onChange(
                      order,
                      shown ? [...hidden, k] : hidden.filter((h) => h !== k),
                    )
                  }
                  className="size-5 accent-[#ff6600]"
                />
                <span className={shown ? "" : "text-muted"}>{label(k)}</span>
              </label>
              <button
                type="button"
                disabled={i === 0}
                onClick={() => shift(i, -1)}
                aria-label={`Move ${label(k)} left`}
                className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:text-ink disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                disabled={i === order.length - 1}
                onClick={() => shift(i, 1)}
                aria-label={`Move ${label(k)} right`}
                className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:text-ink disabled:opacity-30"
              >
                ↓
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
