import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR } from "@/lib/bots";
import { parseOkr } from "@/lib/family-stats";
import { providerStrip, type Provider } from "@/lib/health";
import { parseReport, type Block } from "@/lib/report-md";
import KeyResults from "../../key-results";
import { SettingsPage } from "../../settings-ui";

export const metadata = { title: "Reports · Settings" };
export const dynamic = "force-dynamic";

// Read-only: the team's numbers with this week's key results, then the Validator's refusal report
// and its near-duplicate packages (queue 31: off the home page), then the clean-up inventory (#cleanup, the target of
// the owner's clean-up decision), as their files have them. The Family review page that used to show them is gone.
const SHARED = path.join(BOTS_DIR, "common-data", "shared-state");
const read = (p: string) => readFile(/*turbopackIgnore: true*/ p, "utf8").catch(() => "");

export default async function ReportsPage() {
  const [team, okr, calls, report, dupes, cleanup] = await Promise.all([
    read(path.join(SHARED, "team-numbers.json")),
    read(path.join(BOTS_DIR, "common-data", "botBox", "routed", "the-ceo", "okr-week.md")),
    read(path.join(SHARED, "model_calls.json")),
    read(path.join(SHARED, "refusal-report.md")),
    read(path.join(SHARED, "package-near-duplicates.md")),
    read(path.join(SHARED, "cleanup-inventory.md")),
  ]);
  let t: Record<string, unknown> = {};
  try {
    t = JSON.parse(team) as Record<string, unknown>;
  } catch {
    /* not written yet */
  }
  const n = (k: string) => (typeof t[k] === "number" ? (t[k] as number) : null);
  const kr = parseOkr(okr);
  return (
    <SettingsPage title="Reports" subtitle="The team's week and the Validator's reports, read-only">
      <section className="rounded-xl bg-panel px-4 py-3" aria-labelledby="team">
        <h2 id="team" className="text-lg font-semibold text-ink">
          Team
        </h2>
        {Object.keys(t).length ? (
          <dl className="mt-2 grid grid-cols-3 gap-3 text-sm">
            <Stat label="Drafts waiting" value={n("drafts_waiting")} />
            <Stat label="Sent this week" value={n("sent_this_week") ?? n("sent_week")} />
            <Stat label="Replies this week" value={n("replies_this_week") ?? n("replies_week")} />
          </dl>
        ) : (
          <p className="mt-1 text-sm text-muted">The Validator has not written team-numbers.json yet.</p>
        )}
        {typeof t.note === "string" ? <p className="mt-1 text-xs text-muted">{t.note}</p> : null}
        {kr ? <KeyResults okr={kr} /> : null}
        <Providers list={providerStrip(calls)} />
      </section>
      <section className="rounded-xl bg-panel px-4 py-3" aria-labelledby="refusals">
        <h2 id="refusals" className="text-lg font-semibold text-ink">
          Refusal report
        </h2>
        {report.trim() ? <Report blocks={parseReport(report)} /> : <p className="mt-1 text-sm text-muted">No refusal report yet.</p>}
      </section>
      <section className="rounded-xl bg-panel px-4 py-3" aria-labelledby="near-duplicates">
        <h2 id="near-duplicates" className="text-lg font-semibold text-ink">
          Near-duplicate packages
        </h2>
        {dupes.trim() ? <Report blocks={parseReport(dupes)} /> : <p className="mt-1 text-sm text-muted">No near-duplicate report yet.</p>}
      </section>
      {cleanup.trim() ? (
        <section id="cleanup" className="scroll-mt-24 rounded-xl bg-panel px-4 py-3" aria-labelledby="cleanup-title">
          <h2 id="cleanup-title" className="text-lg font-semibold text-ink">
            Clean-up inventory
          </h2>
          <Report blocks={parseReport(cleanup)} />
        </section>
      ) : null}
    </SettingsPage>
  );
}

function Stat({ label, value }: { label: string; value: number | null }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-2xl font-semibold text-ink tabular-nums">{value ?? "—"}</dd>
    </div>
  );
}

/** Today's model providers: calls and a dot, green answering, red failing, grey before the engine logs health; the
 *  Validator's judge (not in the chain) has no dot. */
function Providers({ list }: { list: Provider[] }) {
  if (!list.length) return null;
  return (
    <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-3 text-xs text-muted">
      <span className="text-ink">Model providers today:</span>
      {list.map((p) => (
        <span key={p.host} className="whitespace-nowrap tabular-nums" title={!p.dot ? "not in the chain: no health kept" : p.ok === null ? "no health logged yet" : p.ok ? "answering" : "failing"}>
          {p.dot ? <span aria-hidden className={`mr-1 inline-block h-2 w-2 rounded-full ${p.ok === null ? "bg-fill-3" : p.ok ? "bg-good" : "bg-bad"}`} /> : null}
          {p.label}: {p.calls}
          {p.dot ? <span className="sr-only">{p.ok === null ? " (no health yet)" : p.ok ? " (answering)" : " (failing)"}</span> : null}
        </span>
      ))}
    </p>
  );
}

/** **bold** and `code` inside a line, as the reports write them; everything else is plain text. */
function Inline({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
          <strong key={i} className="font-semibold text-ink">
            {part.slice(2, -2)}
          </strong>
        ) : part.startsWith("`") && part.endsWith("`") && part.length > 2 ? (
          <code key={i} className="rounded bg-fill-3 px-1 font-mono text-[0.92em]">
            {part.slice(1, -1)}
          </code>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Report({ blocks }: { blocks: Block[] }) {
  return (
    <div className="mt-1">
      {blocks.map((b, i) =>
        b.kind === "table" ? (
          <div key={i} className="my-2 overflow-x-auto">
            <table className="w-full text-sm tabular-nums">
              <thead>
                <tr className="text-left text-xs text-muted">
                  {b.head.map((c, k) => (
                    <th key={k} className="py-1 pr-3 font-medium">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {b.rows.map((r, k) => (
                  <tr key={k}>
                    {r.map((c, j) => (
                      <td key={j} className="py-1 pr-3 align-top">
                        <Inline text={c} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : b.kind === "h1" ? (
          <h3 key={i} className="mt-2 text-base font-semibold text-ink">
            {b.text}
          </h3>
        ) : b.kind === "h2" ? (
          <h4 key={i} className="mt-3 text-sm font-semibold text-ink">
            {b.text}
          </h4>
        ) : b.kind === "li" ? (
          <p key={i} className="ml-3 text-xs break-words text-muted">
            • <Inline text={b.text} />
          </p>
        ) : (
          <p key={i} className="text-sm break-words text-muted">
            <Inline text={b.text} />
          </p>
        ),
      )}
    </div>
  );
}
