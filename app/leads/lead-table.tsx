"use client";
// The Table tab: every cell of every lead
// as a grid, one line per lead. Click a header to sort (again for the other way, a third time for the board's order);
// the business stays in view while the grid scrolls sideways, the headers while it scrolls down. A row opens the same
// drawer as the Board, where cells are edited. Long text shows its first line; the full cell is in the drawer.
import { useEffect, useMemo, useState } from "react";
import { telHref } from "@/lib/phone";
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
    get: (r) => r.siteHealth ?? null,
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
    get: (r) => r.foundBy ?? null,
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

function Cell({ col, row }: { col: Col; row: TableRow }) {
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
        className={`block truncate text-accent-ink hover:underline ${WIDTH.link}`}
      >
        {text.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}
      </a>
    );
  return (
    <span
      title={text.length > 40 ? text : undefined}
      className={`block truncate ${WIDTH[col.kind]}`}
    >
      {col.kind === "long" ? text.split("\n")[0] : text}
    </span>
  );
}

export default function LeadTable({
  rows,
  onOpen,
}: {
  rows: TableRow[];
  onOpen: (id: string) => void;
}) {
  const [sort, setSort] = useState<Sort>(null);
  // how many rows are drawn ("how to see more"): 500 at a time, or all
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
  const next = (key: string) =>
    setSort(
      !sort || sort.key !== key
        ? { key, dir: 1 }
        : sort.dir === 1
          ? { key, dir: -1 }
          : null,
    );
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
      draggable={k !== "business"}
      onDragStart={(e) => {
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
        onClick={() => next(k)}
        title={
          k === "business"
            ? `Sort by ${label}`
            : `Sort by ${label}; drag to move the column`
        }
        className={`group/sort inline-flex min-h-11 w-full items-center gap-1.5 px-3 whitespace-nowrap hover:bg-bg hover:text-ink ${sort?.key === k ? "font-semibold text-ink" : ""}`}
      >
        {label}
        <SortIcon dir={sort?.key === k ? sort.dir : 0} />
      </button>
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
              Click a heading to sort by it. To move a column, drag its heading
              or use Columns.
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
      <div className="relative max-h-[calc(100dvh-10rem)] overflow-auto rounded-xl border border-line bg-panel">
        <table className="w-max min-w-full border-separate border-spacing-0 text-sm">
          <caption className="sr-only">
            Every lead with every cell; a header sorts, a row opens the lead.
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
                onClick={() => onOpen(r.id)}
                className="group cursor-pointer"
              >
                <th
                  scope="row"
                  className="sticky left-0 z-[5] max-w-64 border-r border-b border-line bg-panel px-3 py-2 text-left font-medium group-hover:bg-accent-tint"
                >
                  {/* the row's number in the order shown (to know which row you are on under a sort) */}
                  <span className="flex items-baseline gap-2">
                    <span className="w-10 shrink-0 text-right text-xs font-normal text-muted tabular-nums">{i + 1}</span>
                    <button
                      type="button"
                      onClick={() => onOpen(r.id)}
                      className="block max-w-52 truncate text-left hover:underline"
                      title={r.business}
                    >
                      {r.business}
                    </button>
                  </span>
                  {r.openFlags ? (
                    <span className="mt-0.5 inline-block rounded-full bg-bad/15 px-2 text-xs font-normal text-bad">
                      {r.openFlags === 1 ? "1 flag" : `${r.openFlags} flags`}
                    </span>
                  ) : null}
                </th>
                {cols.map((c) => (
                  <td
                    key={c.key}
                    className={`border-b border-line px-3 py-2 align-top whitespace-nowrap group-hover:bg-accent-tint ${c.kind === "number" ? "text-right tabular-nums" : ""}`}
                  >
                    <Cell col={c} row={r} />
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
