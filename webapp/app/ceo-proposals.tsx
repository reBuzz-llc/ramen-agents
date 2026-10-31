import { listBots } from "@/lib/bots";
import { describe, readBoard, type Proposal } from "@/lib/ceo-proposals";
import CeoProposalActions from "./ceo-proposal-actions";

/** "CEO proposals (n open)": The CEO's proposed changes to the owner's work plan, each with Approve / Decline; the
 *  last 7 days' decisions collapsed below. Hidden when there are none. `compact` (the home board) folds it to its title. */
export default async function CeoProposals({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const [{ open, decided }, bots] = await Promise.all([readBoard().catch(() => ({ open: [], decided: [] })), listBots().catch(() => [])]);
  if (!open.length && !decided.length) return null;
  const name = (slug: string) => bots.find((b) => b.slug === slug)?.name ?? slug;
  const title = `CEO proposals (${open.length} open)`;
  const body = (
    <>
      {open.length ? (
        <ul className="mt-1 divide-y divide-line text-sm">
          {open.map((p) => (
            <li key={p.id} className="py-2">
              <Body p={p} bot={name(p.bot)} />
              <CeoProposalActions id={p.id} canApprove={p.change !== null} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">Nothing open.</p>
      )}
      {decided.length ? (
        <details className="mt-1 text-sm">
          <summary className="cursor-pointer text-xs text-muted">Decided in the last 7 days ({decided.length})</summary>
          <ul className="mt-1 divide-y divide-line">
            {decided.map((p) => (
              <li key={p.id} className="py-1.5">
                <span className={`mr-2 text-xs font-semibold ${p.status === "approved" ? "text-good" : "text-muted"}`}>
                  {p.status === "approved" ? "Approved" : "Declined"} {p.decided_at.replace("T", " ").slice(5, 16)}
                </span>
                <span className="text-ink">
                  {name(p.bot)}: {describe(p.change)}
                </span>
                {p.owner_note ? <span className="text-muted"> · “{p.owner_note}”</span> : null}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
  return (
    <div className={className}>
      {compact ? (
        <details id="proposals" className="scroll-mt-24 rounded-lg border border-line bg-panel px-3 py-2">
          <summary className="cursor-pointer text-sm font-semibold text-ink">{title}</summary>
          {body}
        </details>
      ) : (
        <section className="rounded-lg border border-line bg-panel px-3 py-2">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {body}
        </section>
      )}
    </div>
  );
}

function Body({ p, bot }: { p: Proposal; bot: string }) {
  return (
    <div className="space-y-0.5">
      <p className="text-ink">
        <span className="font-semibold">{bot}</span>
        <span className="ml-2 text-xs text-muted tabular-nums">{p.ts.replace("T", " ").slice(5, 16)}</span>
        <br />
        {describe(p.change)}
      </p>
      {p.reason ? <p className="text-xs text-muted">Why: {p.reason}</p> : null}
      {p.metric || p.expected ? (
        <p className="text-xs text-muted">
          Measure: {p.metric || "–"}
          {p.expected ? ` · expected: ${p.expected}` : ""}
        </p>
      ) : null}
      <p className="text-xs text-muted">Validator: {p.validator_note || "not reviewed yet"}</p>
    </div>
  );
}
