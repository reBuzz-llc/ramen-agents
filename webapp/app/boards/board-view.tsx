"use client";
// The local board's pages (queue 572): Leads, Tasks and Packages (with the rate card), the rows the agents and people
// share. Every table sorts (SortableTable); a row opens to edit every cell; a person's edit is theirs (an agent's later
// write to that cell is refused). The Leads page also takes a CSV (the board's columns by name; a filled cell is never
// overwritten). Nothing here talks to the network: the board is the SQLite file on this Mac (lib/local-board.ts).
import Link from "next/link";
import { Fragment, useMemo, useRef, useState } from "react";
import type { Board, FieldSpec } from "@/lib/local-board";
import SortableTable from "../sortable-table";

type Row = Record<string, unknown> & { id: string };
const TABS: { board: "leads" | "tasks" | "packages"; label: string }[] = [
  { board: "leads", label: "Leads" },
  { board: "tasks", label: "Tasks" },
  { board: "packages", label: "Packages" },
];
/** The columns each board shows in its table (every cell is in the row's editor). */
const COLUMNS: Record<Board, string[]> = {
  leads: ["business", "website", "location", "industry", "pain_point", "business_email", "email_status", "result", "updated_at"],
  tasks: ["title", "status", "priority", "due", "projects", "updated_at"],
  packages: ["name", "status", "price", "buyer", "by", "review_verdict", "updated_at"],
  rates: ["line", "offer", "price"],
};
const TITLE: Record<Board, string> = { leads: "business", tasks: "title", packages: "name", rates: "line" };
const CHOICES: Partial<Record<Board, Record<string, string[]>>> = {
  tasks: { status: ["Not started", "In progress", "Done"], priority: ["", "Low", "Medium", "High"] },
  packages: { status: ["draft", "published"] },
  leads: {
    email_status: ["", "Ready to Send Email", "Email Sent", "Bounced"],
    whatsapp_status: ["", "WhatsApp Verified", "WhatsApp msg sent", "False Whatsapp Number"],
    result: ["", "Emailed", "Replied", "Meeting", "Client", "Not interested", "Bounced"],
  },
};

const text = (v: unknown) => (v === null || v === undefined ? "" : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? JSON.stringify(v) : String(v));
const LONG = new Set(["pain_point", "evidence", "draft_email", "draft_whatsapp", "details", "deliverables", "offer", "why", "sources", "notes", "source_pages", "review_note"]);

export default function BoardView({ board, rows: initial, fields, rates, rateFields, local, portal }: { board: Board; rows: Row[]; fields: FieldSpec[]; rates?: Row[]; rateFields?: FieldSpec[]; local: boolean; portal: string }) {
  return (
    <div className="space-y-4">
      <nav className="flex flex-wrap items-center gap-2" aria-label="Boards">
        {TABS.map((t) => (
          <Link key={t.board} href={`/boards/${t.board}`} aria-current={t.board === board ? "page" : undefined} className={`rounded-full px-4 py-2 text-sm font-semibold ${t.board === board ? "bg-accent text-white" : "bg-panel text-ink"}`}>
            {t.label}
          </Link>
        ))}
        {board === "leads" ? (
          <Link href="/work-plan/leads" className="ml-auto text-sm font-semibold text-accent-ink hover:underline">
            Results and pipeline →
          </Link>
        ) : null}
      </nav>
      {!local ? (
        <p className="rounded-xl bg-panel p-4 text-sm">
          Your boards live on the hosted portal ({portal}): open them there. This page shows the local board, which is not in use.
        </p>
      ) : (
        <>
          <Table board={board} initial={initial} fields={fields} />
          {board === "packages" && rates && rateFields ? (
            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Rate card</h2>
              <p className="text-sm text-muted">What each line of work costs. The agents read it when they price a package or a first email.</p>
              <Table board="rates" initial={rates} fields={rateFields} />
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}

function Table({ board, initial, fields }: { board: Board; initial: Row[]; fields: FieldSpec[] }) {
  const [rows, setRows] = useState(initial);
  const [open, setOpen] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [note, setNote] = useState<string>("");
  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const cols = COLUMNS[board].map((k) => ({ key: k, label: byKey.get(k)?.label ?? (k === "updated_at" ? "Updated" : k) }));
  const shown = q.trim() ? rows.filter((r) => Object.values(r).some((v) => text(v).toLowerCase().includes(q.trim().toLowerCase()))) : rows;

  async function save(id: string | undefined, fieldsIn: Record<string, unknown>, extra: { create?: boolean; archive?: boolean } = {}) {
    const res = await fetch("/api/local-board", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ board, id, fields: fieldsIn, ...extra }) });
    const b = (await res.json().catch(() => ({}))) as { row?: Row; error?: string; refused?: { field: string; reason: string }[] };
    if (!res.ok || !b.row) {
      setNote(b.error ?? `Not saved (HTTP ${res.status}).`);
      return null;
    }
    const row = b.row;
    if (extra.archive) setRows((rs) => rs.filter((r) => r.id !== row.id));
    else setRows((rs) => (rs.some((r) => r.id === row.id) ? rs.map((r) => (r.id === row.id ? row : r)) : [row, ...rs]));
    setNote(extra.archive ? "Archived." : extra.create ? "Added." : "Saved.");
    return row;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter" aria-label="Filter rows" className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-panel px-3 text-sm sm:max-w-xs" />
        <AddRow board={board} title={byKey.get(TITLE[board])?.label ?? "Name"} onAdd={(v) => save(undefined, { [TITLE[board]]: v }, { create: true })} />
        {board === "leads" ? <ImportCsv onDone={(msg, added) => { setNote(msg); if (added) location.reload(); }} /> : null}
        {board !== "rates" ? (
          <a href={`/api/local-board/export?board=${board}`} download className="inline-flex h-11 items-center rounded-xl border border-line px-4 text-sm font-semibold hover:bg-panel">
            Export CSV
          </a>
        ) : null}
        <span className="text-sm text-muted tabular-nums">{shown.length} of {rows.length}</span>
      </div>
      {note ? (
        <p role="status" className="rounded-lg bg-panel px-3 py-2 text-sm">
          {note}
        </p>
      ) : null}
      {rows.length ? (
        <div className="overflow-x-auto rounded-xl border border-line bg-panel">
          <SortableTable className="w-full min-w-[640px] text-left text-sm">
            <thead>
              <tr className="border-b border-line text-xs text-muted">
                {cols.map((c) => (
                  <th key={c.key} className="px-3 py-2 font-semibold">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => (
                <Fragment key={r.id}>
                  <tr className="cursor-pointer border-b border-line/60 align-top hover:bg-black/[0.03]" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    {cols.map((c) => (
                      <td key={c.key} className="max-w-[18rem] px-3 py-2 break-words" data-sort={c.key === "updated_at" ? text(r[c.key]) : undefined}>
                        {c.key === "updated_at" ? text(r[c.key]).slice(0, 16).replace("T", " ") : <span className="line-clamp-3">{text(r[c.key])}</span>}
                      </td>
                    ))}
                  </tr>
                  {open === r.id ? (
                    <tr>
                      <td colSpan={cols.length} className="border-b border-line bg-[#fbf6ee] px-3 py-3 dark:bg-black/20">
                        <Editor board={board} row={r} fields={fields} onSave={(f) => save(r.id, f)} onArchive={() => save(r.id, {}, { archive: true })} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </SortableTable>
        </div>
      ) : (
        <p className="rounded-xl bg-panel p-4 text-sm text-muted">
          {board === "leads" ? "No leads yet: Lead Gen adds them as it finds them, or import a CSV." : board === "tasks" ? "No tasks yet: The CEO adds them." : board === "packages" ? "No packages yet: the Package Designer hands them over as drafts." : "No rates yet."}
        </p>
      )}
    </div>
  );
}

function AddRow({ title, onAdd }: { board: Board; title: string; onAdd: (v: string) => Promise<unknown> }) {
  const [v, setV] = useState("");
  return (
    <form
      className="flex gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!v.trim()) return;
        if (await onAdd(v.trim())) setV("");
      }}
    >
      <input value={v} onChange={(e) => setV(e.target.value)} placeholder={`New: ${title}`} aria-label={`New row: ${title}`} className="h-11 w-44 rounded-xl border border-line bg-panel px-3 text-sm" />
      <button className="h-11 rounded-full bg-accent px-4 text-sm font-semibold text-white">Add</button>
    </form>
  );
}

function ImportCsv({ onDone }: { onDone: (msg: string, added: boolean) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <input
        ref={ref}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setBusy(true);
          const res = await fetch("/api/local-board/import", { method: "POST", body: await f.text() });
          const b = (await res.json().catch(() => ({}))) as { error?: string; created?: number; filled?: number; keptFilled?: number; skipped?: number; unmatched?: string[]; errors?: string[] };
          setBusy(false);
          e.target.value = "";
          if (!res.ok) return onDone(`${b.error ?? `Not imported (HTTP ${res.status}).`}${b.unmatched?.length ? ` Columns that matched nothing: ${b.unmatched.join(", ")}.` : ""}`, false);
          const parts = [`${b.created ?? 0} added`, `${b.filled ?? 0} filled in`];
          if (b.keptFilled) parts.push(`${b.keptFilled} filled cells left as they were`);
          if (b.skipped) parts.push(`${b.skipped} rows without a business skipped`);
          onDone(`Imported: ${parts.join(", ")}.${b.unmatched?.length ? ` Columns that matched nothing (not imported): ${b.unmatched.join(", ")}.` : ""}${b.errors?.length ? ` ${b.errors.join("; ")}` : ""}`, (b.created ?? 0) + (b.filled ?? 0) > 0);
        }}
      />
      <button type="button" disabled={busy} onClick={() => ref.current?.click()} className="h-11 rounded-full border border-line bg-panel px-4 text-sm font-semibold disabled:opacity-60">
        {busy ? "Importing…" : "Import CSV"}
      </button>
    </>
  );
}

function Editor({ board, row, fields, onSave, onArchive }: { board: Board; row: Row; fields: FieldSpec[]; onSave: (f: Record<string, unknown>) => Promise<unknown>; onArchive: () => void }) {
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.key, text(row[f.key])])));
  const [confirm, setConfirm] = useState(false);
  const changed = fields.filter((f) => f.kind !== "json" && draft[f.key] !== text(row[f.key]));
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!changed.length) return;
        await onSave(Object.fromEntries(changed.map((f) => [f.key, f.kind === "bool" ? draft[f.key] === "true" : draft[f.key] || null])));
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((f) => {
          const choices = CHOICES[board]?.[f.key];
          const v = draft[f.key] ?? "";
          const set = (x: string) => setDraft((d) => ({ ...d, [f.key]: x }));
          const id = `${row.id}-${f.key}`;
          return (
            <label key={f.key} htmlFor={id} className={`grid gap-1 text-xs font-medium text-muted ${LONG.has(f.key) ? "sm:col-span-2" : ""}`}>
              {f.label}
              {f.kind === "json" ? (
                <span className="text-sm text-ink">{v || "—"}</span>
              ) : choices ? (
                <select id={id} value={v} onChange={(e) => set(e.target.value)} className="h-11 rounded-xl border border-line bg-panel px-3 text-sm text-ink">
                  {[...new Set([...choices, v])].map((c) => (
                    <option key={c} value={c}>
                      {c || "—"}
                    </option>
                  ))}
                </select>
              ) : f.kind === "bool" ? (
                <select id={id} value={v === "true" ? "true" : "false"} onChange={(e) => set(e.target.value)} className="h-11 rounded-xl border border-line bg-panel px-3 text-sm text-ink">
                  <option value="false">No</option>
                  <option value="true">Yes</option>
                </select>
              ) : LONG.has(f.key) ? (
                <textarea id={id} value={v} onChange={(e) => set(e.target.value)} rows={3} className="rounded-xl border border-line bg-panel px-3 py-2 text-sm text-ink" />
              ) : (
                <input id={id} value={v} type={f.kind === "date" ? "date" : "text"} inputMode={f.kind === "number" ? "decimal" : undefined} onChange={(e) => set(e.target.value)} className="h-11 rounded-xl border border-line bg-panel px-3 text-sm text-ink" />
              )}
            </label>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button disabled={!changed.length} className="h-11 rounded-full bg-accent px-5 text-sm font-semibold text-white disabled:opacity-50">
          Save{changed.length ? ` (${changed.length})` : ""}
        </button>
        {confirm ? (
          <>
            <span className="text-sm">Archive this row? The agents stop seeing it.</span>
            <button type="button" onClick={onArchive} className="h-11 rounded-full border border-line px-4 text-sm font-semibold text-bad">
              Archive
            </button>
            <button type="button" onClick={() => setConfirm(false)} className="h-11 rounded-full px-4 text-sm">
              Keep
            </button>
          </>
        ) : (
          <button type="button" onClick={() => setConfirm(true)} className="h-11 rounded-full px-4 text-sm font-semibold text-muted">
            Archive…
          </button>
        )}
      </div>
    </form>
  );
}
