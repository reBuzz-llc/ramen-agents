"use client";
import { agentName } from "@/lib/agent-names";
// Import leads: 1 choose a CSV or spreadsheet (read here, in the browser, up to 25 MB), 2 check the
// columns (matched by their headers; change any) and the import rules (on by default for a Google Maps export), 3 the
// dry run on the whole file: rows with an email, rows with a phone only ("no email, listing only"), rows with neither,
// what the rules left out, the duplicates; 4 import a group, 100 rows a request (the server stops after 40 s and says how
// many it handled) with a progress bar, then the other -- or Import all, both in turn with one overall bar, and Resume
// after a stop, which carries on from the row reached;
// one report for the file, downloadable. The rows are mapped here, so a 5 MB export sends only what the board keeps.
import Link from "next/link";
import { useRef, useState } from "react";
import {
  autoMap,
  BATCH,
  FIELD_LABEL,
  IMPORT_FIELDS,
  isMapsExport,
  keyOf,
  mapRows,
  MAX_FILE_BYTES,
  MAX_ROWS,
  parseCsv,
  type ImportField,
  type MappedRow,
} from "@/lib/lead-import-map";
import { btnOutline, btnPrimary, btnText, control } from "@/lib/ui-classes";

type Past = {
  id: string;
  at: string;
  by: string;
  file: string;
  created: number;
  skipped: number;
  rejected: number;
};
type Reason = { reason: string; n: number };
type Line = { row: number; business: string; outcome: string; reason: string };
type Plan = {
  email: { rows: number[]; social: number };
  listing: { rows: number[]; social: number };
  excluded: Reason[];
  skipped: Reason[];
  rejected: number;
  notCreated: Line[];
};
type Rules = {
  states: string[] | null;
  skipClosed: boolean;
  skipChains: boolean;
  needContact: boolean;
};
type Batch = "email" | "listing";

const MAPS_RULES: Rules = {
  states: ["NY", "NJ"],
  skipClosed: true,
  skipChains: true,
  needContact: true,
};
const NO_RULES: Rules = {
  states: null,
  skipClosed: false,
  skipChains: false,
  needContact: false,
};
const MAPS_PACKAGE = "SMB Website Care Retainer";
const n = (x: number) => x.toLocaleString();

async function readTable(file: File): Promise<string[][]> {
  if (/\.(xlsx|xls)$/i.test(file.name)) {
    const { default: readXlsxFile } = await import("read-excel-file/browser");
    // version 9 reads every sheet; the first one is the list
    const sheets = await readXlsxFile(file);
    const rows = (sheets[0]?.data ?? []) as unknown[][];
    return rows
      .map((r) =>
        r.map((c) =>
          c === null || c === undefined
            ? ""
            : c instanceof Date
              ? c.toISOString().slice(0, 10)
              : String(c),
        ),
      )
      .filter((r) => r.some((c) => c.trim()));
  }
  return parseCsv(await file.text());
}

/** What the server said when it did not answer JSON (a cut-off batch once showed only "failed"). */
export function serverError(status: number, text: string): string {
  if (status === 504 || /FUNCTION_INVOCATION_TIMEOUT/.test(text)) return `The server ran out of time (${status}).`;
  if (status === 413 || /FUNCTION_PAYLOAD_TOO_LARGE/.test(text)) return `The request was too large for the server (${status}).`;
  const said = text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 160);
  return `The server answered ${status}${said ? `: ${said}` : ""}.`;
}

async function post(body: object) {
  const r = await fetch("/api/leads/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { ok: false, error: serverError(r.status, text) };
  }
}
/** Rows sent in one request: the server also stops after 40 s and says how many it handled, and the rest goes next. */
const CHUNK = 100;
const ORDER: Batch[] = ["email", "listing"];
const GROUP_NAME: Record<Batch, string> = { email: "rows with an email", listing: "phone-only rows" };

export default function ImportView({
  past,
  packages,
}: {
  past: Past[];
  packages: string[];
}) {
  const [file, setFile] = useState<File | null>(null);
  const [table, setTable] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<(ImportField | null)[]>([]);
  const [rules, setRules] = useState<Rules>(NO_RULES);
  const [pkg, setPkg] = useState("");
  const [plan, setPlan] = useState<Plan | null>(null);
  const [importId, setImportId] = useState<string | undefined>(undefined);
  const [imported, setImported] = useState<
    Partial<Record<Batch, { created: number; skipped: number }>>
  >({});
  const [busy, setBusy] = useState(false);
  // k: the share done; null until the first request answers ("Starting…": a cold start can take a while)
  const [progress, setProgress] = useState<{ batch: Batch; k: number | null } | null>(
    null,
  );
  const [error, setError] = useState("");
  // Import all's overall bar, and where a stopped run can resume
  const [overall, setOverall] = useState<{ done: number; total: number; batch: Batch } | null>(null);
  const [stopped, setStopped] = useState<{ all: boolean; batch: Batch } | null>(null);
  const handledRef = useRef<Partial<Record<Batch, number>>>({});
  const [handled, setHandled] = useState<Partial<Record<Batch, number>>>({}); // the same, for the labels
  const sumsRef = useRef<Partial<Record<Batch, { created: number; skipped: number }>>>({});
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const headers = table[0] ?? [];
  const rows = table.slice(1);
  const maps = isMapsExport(mapping);
  const mapped = new Set(mapping.filter(Boolean));
  const pkgChoices = [...new Set([MAPS_PACKAGE, ...packages])].sort();

  const reset = () => {
    setPlan(null);
    setImportId(undefined);
    setImported({});
    setStopped(null);
    handledRef.current = {};
    setHandled({});
    sumsRef.current = {};
  };
  const pick = async (f: File) => {
    setError("");
    reset();
    if (f.size > MAX_FILE_BYTES)
      return setError(
        `That file is ${(f.size / 1048576).toFixed(1)} MB; the limit is 25 MB.`,
      );
    try {
      const t = await readTable(f);
      if (t.length < 2)
        return setError("That file has no rows under its header.");
      if (t.length - 1 > MAX_ROWS)
        return setError(
          `${n(t.length - 1)} rows: at most ${n(MAX_ROWS)} at a time. Split the file.`,
        );
      const m = autoMap(t[0]);
      setFile(f);
      setTable(t);
      setMapping(m);
      setRules(isMapsExport(m) ? MAPS_RULES : NO_RULES);
      setPkg(isMapsExport(m) ? MAPS_PACKAGE : "");
    } catch {
      setError(
        "That file could not be read. Save it as CSV (UTF-8) or XLSX and try again.",
      );
    }
  };
  const check = async () => {
    setBusy(true);
    setError("");
    try {
      const d = await post({
        dry: true,
        records: mapRows(rows, mapping).map(keyOf),
        rules,
      });
      if (!d.ok) setError(d.error ?? "That failed.");
      else {
        // a fresh check starts the groups over: rows imported meanwhile are now "already on the board"
        setPlan(d);
        setImported({});
        setStopped(null);
        handledRef.current = {};
        setHandled({});
        sumsRef.current = {};
      }
    } catch {
      setError("No answer from the server.");
    } finally {
      setBusy(false);
    }
  };
  /** One group, from where it stopped last time (handled[batch]): never a row sent twice; the server's duplicate check
   *  is the second guard. Answers whether the group finished. `idIn` carries the file's one report across groups. */
  const runGroup = async (batch: Batch, idIn: string | undefined, onStep?: (handledNow: number) => void): Promise<{ ok: boolean; id: string | undefined }> => {
    if (!plan) return { ok: false, id: idIn };
    const all = mapRows(rows, mapping);
    // plan rows are file rows: the header is row 1, so data row i is row i + 2
    const picked: (MappedRow & { row: number })[] = plan[batch].rows.map((row) => ({ ...all[row - 2], row }));
    let id = idIn;
    let at = handledRef.current[batch] ?? 0;
    const sum = { ...(sumsRef.current[batch] ?? { created: 0, skipped: 0 }) };
    setProgress({ batch, k: at ? at / picked.length : null });
    try {
      while (at < picked.length) {
        const chunk = picked.slice(at, at + Math.min(CHUNK, BATCH));
        const d = await post({
          dry: false,
          records: chunk,
          batch,
          maps,
          packageForWebsite: pkg || undefined,
          fileName: file?.name ?? "",
          importId: id,
          excluded: id ? undefined : plan.notCreated,
        });
        if (!d.ok) {
          setError(`${d.error ?? "That failed."} ${n(at)} of ${n(picked.length)} ${GROUP_NAME[batch]} were handled. Resume carries on from there.`);
          return { ok: false, id };
        }
        id = d.id;
        setImportId(d.id);
        sum.created += d.created;
        sum.skipped += d.skipped;
        // the server says how many rows it handled before its time budget ran out; the rest goes in the next request
        const done = typeof d.done === "number" && d.done > 0 ? Math.min(d.done, chunk.length) : chunk.length;
        at += done;
        handledRef.current = { ...handledRef.current, [batch]: at };
        setHandled(handledRef.current);
        sumsRef.current = { ...sumsRef.current, [batch]: sum };
        setProgress({ batch, k: at / picked.length });
        onStep?.(done);
      }
      setImported((x) => ({ ...x, [batch]: sum }));
      return { ok: true, id };
    } catch {
      setError(`No answer from the server after ${n(at)} of ${n(picked.length)} ${GROUP_NAME[batch]}. Resume carries on from there.`);
      return { ok: false, id };
    } finally {
      setProgress(null);
    }
  };
  const run = async (batch: Batch) => {
    setBusy(true);
    setError("");
    setStopped(null);
    const r = await runGroup(batch, importId);
    if (!r.ok) setStopped({ all: false, batch });
    setBusy(false);
  };
  /** Import all: the email group, then the phone-only group (with the rows with neither while
   *  that rule is off), one overall bar, one report for the file; a stop offers Resume, which skips what was handled. */
  const runAll = async () => {
    if (!plan) return;
    setBusy(true);
    setError("");
    setStopped(null);
    const order = ORDER.filter((b) => plan[b].rows.length && !imported[b]);
    const total = ORDER.reduce((t, b) => t + plan[b].rows.length, 0);
    let doneAll = ORDER.reduce((t, b) => t + (imported[b] ? plan[b].rows.length : (handledRef.current[b] ?? 0)), 0);
    let id = importId;
    for (const b of order) {
      setOverall({ done: doneAll, total, batch: b });
      const r = await runGroup(b, id, (k) => {
        doneAll += k;
        setOverall({ done: doneAll, total, batch: b });
      });
      id = r.id;
      if (!r.ok) {
        setStopped({ all: true, batch: b });
        setOverall(null);
        setBusy(false);
        return;
      }
    }
    setOverall(null);
    setBusy(false);
  };

  const group = (batch: Batch, title: string, hint: string) => {
    const g = plan![batch];
    const done = imported[batch];
    return (
      <div className="rounded-xl border border-line bg-bg p-4">
        <p className="text-2xl font-bold tabular-nums">{n(g.rows.length)}</p>
        <p className="font-medium">{title}</p>
        <p className="mt-1 text-xs text-muted">
          {hint}
          {g.social
            ? ` ${n(g.social)} gave a social or listing page as their website: it goes to Source pages, not Website.`
            : ""}
        </p>
        <div className="mt-3">
          {done ? (
            <p className="text-sm text-good">
              ✓ {n(done.created)} imported
              {done.skipped ? `, ${n(done.skipped)} already there` : ""}
            </p>
          ) : (
            <button
              type="button"
              disabled={busy || !g.rows.length}
              onClick={() => void run(batch)}
              className={btnOutline}
            >
              {progress?.batch === batch
                ? progress.k === null
                  ? "Starting…"
                  : "Importing…"
                : handled[batch]
                  ? `Resume (${n(g.rows.length - (handled[batch] ?? 0))} left)`
                  : `Import ${n(g.rows.length)}`}
            </button>
          )}
          {progress?.batch === batch ? (
            <div
              className="mt-2"
              role="progressbar"
              aria-valuenow={Math.round((progress.k ?? 0) * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label={`Importing ${title}`}
            >
              <div className="h-2 rounded-full bg-line">
                <div
                  className="h-2 rounded-full bg-accent transition-[width]"
                  style={{
                    width: `${Math.max(3, Math.round((progress.k ?? 0) * 100))}%`,
                  }}
                />
              </div>
              <p className="mt-1 text-xs text-muted">
                {progress.k === null
                  ? `Starting… (the first ${n(Math.min(CHUNK, g.rows.length))} rows)`
                  : `${n(Math.round(progress.k * g.rows.length))} of ${n(g.rows.length)}`}
              </p>
            </div>
          ) : null}
        </div>
      </div>
    );
  };
  const neither =
    plan?.excluded.find((r) => r.reason.startsWith("neither"))?.n ?? 0;
  const allRows = plan ? ORDER.reduce((t, b) => t + plan[b].rows.length, 0) : 0;
  const allDone = !!plan && ORDER.every((b) => !plan[b].rows.length || imported[b]);

  return (
    <div className="max-w-4xl">
      <Link href="/leads?tab=board" className={btnText}>
        ← Leads
      </Link>
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Import leads</h1>
      <p className="mt-1 text-[0.9375rem] text-muted">
        Businesses you gathered, from a CSV or a spreadsheet (a Google Maps
        export works as it is). New ones join the board as yours; the {agentName("Lead Enricher")}
        fills their empty cells and the {agentName("Validator")} checks them like any other
        row.
      </p>

      {!table.length ? (
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void pick(f);
          }}
          className={`mt-6 rounded-2xl border-2 border-dashed p-8 text-center ${over ? "border-accent bg-accent-tint" : "border-line bg-panel"}`}
        >
          <p className="text-base font-semibold">Drop a CSV or XLSX here</p>
          <p className="mt-1 text-sm text-muted">
            Up to 25 MB and {n(MAX_ROWS)} rows. The first row names the columns:
            business, website, email, phone, city, industry… or a Google Maps
            export&apos;s own.
          </p>
          <button
            type="button"
            onClick={() => input.current?.click()}
            className={`mt-4 ${btnPrimary}`}
          >
            Choose a file
          </button>
          <input
            ref={input}
            type="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            hidden
            onChange={(e) =>
              e.target.files?.[0] && void pick(e.target.files[0])
            }
          />
        </div>
      ) : (
        <>
          <section className="mt-6 rounded-2xl border border-line bg-panel p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">
                {file?.name} · {n(rows.length)} rows
                {maps ? " · a Google Maps export" : ""}
              </h2>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  reset();
                  setTable([]);
                  setFile(null);
                }}
                className={btnText}
              >
                Choose another file
              </button>
            </div>
            <p className="mt-1 text-sm text-muted">
              Check what each column is. Columns matched by their header are
              set; change any, or skip it.
            </p>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr>
                    {headers.map((h, i) => (
                      <th
                        key={i}
                        className="min-w-40 px-2 pb-2 text-left align-bottom font-normal"
                      >
                        <span className="block truncate text-xs text-muted">
                          {h || `column ${i + 1}`}
                        </span>
                        <select
                          value={mapping[i] ?? ""}
                          disabled={busy}
                          onChange={(e) => {
                            const v = (e.target.value ||
                              null) as ImportField | null;
                            reset();
                            setMapping((m) =>
                              m.map((x, j) =>
                                j === i ? v : x === v && v ? null : x,
                              ),
                            );
                          }}
                          aria-label={`Column ${h || i + 1} is`}
                          className={`${control} mt-1 ${mapping[i] ? "border-accent" : ""}`}
                        >
                          <option value="">Skip</option>
                          {IMPORT_FIELDS.map((f) => (
                            <option key={f} value={f}>
                              {FIELD_LABEL[f]}
                              {mapped.has(f) && mapping[i] !== f
                                ? " (in use)"
                                : ""}
                            </option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.slice(0, 4).map((r, k) => (
                    <tr key={k}>
                      {headers.map((_, i) => (
                        <td
                          key={i}
                          className={`max-w-56 truncate px-2 py-1.5 ${mapping[i] ? "" : "text-muted"}`}
                        >
                          {r[i] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!mapped.has("business") ? (
              <p className="mt-3 text-sm text-bad">
                Pick the column with the business name.
              </p>
            ) : null}

            <div className="mt-5 border-t border-line pt-4">
              <fieldset disabled={busy}>
                <legend className="text-sm font-semibold">
                  Import rules{maps ? " (set for a Google Maps export)" : ""}
                </legend>
                <div className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-2">
                  <label className="flex min-h-11 items-center gap-2">
                    <input
                      type="checkbox"
                      checked={rules.states !== null}
                      onChange={(e) => {
                        reset();
                        setRules((r) => ({
                          ...r,
                          states: e.target.checked ? ["NY", "NJ"] : null,
                        }));
                      }}
                      className="size-5 accent-[#ff6600]"
                    />
                    Only these states:
                    <input
                      value={(rules.states ?? []).join(", ")}
                      disabled={rules.states === null}
                      onChange={(e) => {
                        reset();
                        setRules((r) => ({
                          ...r,
                          states: e.target.value
                            .split(/[,\s]+/)
                            .map((s) => s.trim().toUpperCase())
                            .filter(Boolean),
                        }));
                      }}
                      aria-label="States"
                      className="h-11 w-24 rounded-xl border border-line bg-panel px-3 text-base disabled:opacity-50"
                    />
                  </label>
                  {(
                    [
                      ["skipClosed", "Leave out CLOSED businesses"],
                      [
                        "skipChains",
                        "Leave out chains (3 or more branches in the file)",
                      ],
                      [
                        "needContact",
                        "Leave out rows with neither an email nor a phone",
                      ],
                    ] as const
                  ).map(([k, label]) => (
                    <label key={k} className="flex min-h-11 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={rules[k]}
                        onChange={(e) => {
                          reset();
                          setRules((r) => ({ ...r, [k]: e.target.checked }));
                        }}
                        className="size-5 accent-[#ff6600]"
                      />
                      {label}
                    </label>
                  ))}
                  <label className="flex min-h-11 flex-wrap items-center gap-2 sm:col-span-2">
                    How we can help, for rows with a website:
                    <select
                      value={pkg}
                      onChange={(e) => setPkg(e.target.value)}
                      aria-label="Package for rows with a website"
                      className="h-11 rounded-xl border border-line bg-panel px-3 text-base"
                    >
                      <option value="">(leave empty)</option>
                      {pkgChoices.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </fieldset>
            </div>
            <div className="mt-4">
              <button
                type="button"
                disabled={busy || !mapped.has("business")}
                onClick={() => void check()}
                className={plan ? btnOutline : btnPrimary}
              >
                {busy && !progress
                  ? "Checking…"
                  : plan
                    ? "Check again"
                    : "Check the rows"}
              </button>
            </div>
          </section>

          {plan ? (
            <section className="mt-6 rounded-2xl border border-line bg-panel p-5">
              <h2 className="text-lg font-semibold">What the import will do</h2>
              <p className="mt-1 text-sm text-muted">
                Nothing is written until you press Import. Import all takes the
                whole file; a group&apos;s own button imports just that group.
              </p>
              {allRows ? (
                <div className="mt-4 rounded-xl border border-line bg-bg p-4" data-import-all>
                  {overall ? (
                    <div role="progressbar" aria-valuenow={Math.round((overall.done / overall.total) * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Importing the whole file">
                      <p className="text-sm font-medium">
                        {progress?.k === null && overall.done === 0 ? "Starting…" : `Importing ${n(overall.done)} of ${n(overall.total)}: ${GROUP_NAME[overall.batch].replace(/ rows$/, "")}`}
                      </p>
                      <div className="mt-2 h-2 rounded-full bg-line">
                        <div className="h-2 rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(3, Math.round((overall.done / overall.total) * 100))}%` }} />
                      </div>
                    </div>
                  ) : allDone ? (
                    <p className="text-sm text-good">✓ The whole file is imported: one report below.</p>
                  ) : stopped ? (
                    <div className="flex flex-wrap items-center gap-3">
                      {error ? (
                        <p role="alert" className="w-full text-sm text-bad">
                          {error}
                        </p>
                      ) : null}
                      <button type="button" className={btnPrimary} disabled={busy} onClick={() => void (stopped.all ? runAll() : run(stopped.batch))}>
                        Resume
                      </button>
                      <span className="text-sm text-muted">Carries on where it stopped; rows already written are never sent again.</span>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-3">
                      <button type="button" className={btnPrimary} disabled={busy} onClick={() => void runAll()}>
                        Import all ({n(allRows)} rows)
                      </button>
                      <span className="text-sm text-muted">The rows with an email first, then the phone-only ones{rules.needContact ? "" : " (with the rows with neither)"}. Or pick one group below.</span>
                    </div>
                  )}
                </div>
              ) : null}
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                {group(
                  "email",
                  "with an email",
                  "They pass the lead rule as they are.",
                )}
                {group(
                  "listing",
                  "phone only: no email, listing only",
                  "Marked so in their notes; the team checks their WhatsApp.",
                )}
                <div className="rounded-xl border border-line bg-bg p-4">
                  <p className="text-2xl font-bold tabular-nums">
                    {n(neither)}
                  </p>
                  <p className="font-medium">
                    with neither an email nor a phone
                  </p>
                  <p className="mt-1 text-xs text-muted">
                    {rules.needContact
                      ? "Left out: no way to reach them."
                      : "Turn on the rule above to leave them out."}
                  </p>
                </div>
              </div>
              <ul className="mt-4 text-sm">
                {[
                  ...plan.excluded.filter(
                    (r) => !r.reason.startsWith("neither"),
                  ),
                  ...plan.skipped,
                ].map((r) => (
                  <li
                    key={r.reason}
                    className="flex justify-between gap-3 border-b border-line py-1.5"
                  >
                    <span className="text-muted">Left out: {r.reason}</span>
                    <span className="tabular-nums">{n(r.n)}</span>
                  </li>
                ))}
                {plan.rejected ? (
                  <li className="flex justify-between gap-3 border-b border-line py-1.5">
                    <span className="text-bad">Rejected: no business name</span>
                    <span className="tabular-nums">{n(plan.rejected)}</span>
                  </li>
                ) : null}
              </ul>
              {importId ? (
                <div className="mt-4 flex flex-wrap gap-3">
                  <a
                    href={`/api/leads/imports/${importId}`}
                    className={btnOutline}
                  >
                    Download the report
                  </a>
                  <Link href="/leads?tab=board" className={btnText}>
                    Open the Leads board
                  </Link>
                </div>
              ) : null}
            </section>
          ) : null}
        </>
      )}
      {error && !stopped ? (
        <p role="alert" className="mt-3 text-sm text-bad">
          {error}
        </p>
      ) : null}

      {past.length ? (
        <section className="mt-10">
          <h2 className="text-lg font-semibold">Earlier imports</h2>
          <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-panel text-sm">
            {past.map((p) => (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2"
              >
                <span>
                  {new Date(p.at).toLocaleString(undefined, {
                    day: "numeric",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}{" "}
                  · {p.by} · {p.file || "a file"}
                  <span className="text-muted">
                    {" "}
                    · {n(p.created)} new, {n(p.skipped)} left out or already
                    there, {n(p.rejected)} rejected
                  </span>
                </span>
                <a href={`/api/leads/imports/${p.id}`} className={btnText}>
                  Report
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
