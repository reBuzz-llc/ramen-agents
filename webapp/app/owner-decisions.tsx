import { ownerDecisions, type Decision } from "@/lib/owner-decisions";
import DecisionActions from "./decision-actions";

/** "Decisions waiting for you", from shared-state/owner-decisions.json: each open item with its date, its
 *  link, one button per option, Done, Later and a note. Answered items leave the list; "Show
 *  decided" lists the last 30 days. Hidden when nothing is open or decided. `compact` (the home board) folds it to its
 *  title line. */
export default async function OwnerDecisions({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  const { open, decided } = await ownerDecisions().catch(() => ({ open: [] as Decision[], decided: [] as Decision[] }));
  if (!open.length && !decided.length) return null;
  const title = `Decisions waiting for you (${open.length})`;
  const body = (
    <>
      {open.length ? (
        <ul className="mt-1 space-y-3 text-sm">
          {open.map((d) => (
            <li key={d.id} className="text-ink">
              <p>
                {d.since ? <span className="mr-2 text-xs text-muted tabular-nums">{d.since.slice(5, 10)}</span> : null}
                {d.text}
                {d.link ? (
                  <a href={d.link.href} className="ml-2 text-xs font-semibold text-accent underline-offset-2 hover:underline">
                    {d.link.label}
                  </a>
                ) : null}
              </p>
              <DecisionActions id={d.id} options={d.options} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-sm text-muted">Nothing waiting.</p>
      )}
      {decided.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-semibold text-accent">Show decided ({decided.length})</summary>
          <ul className="mt-1 space-y-1 text-xs text-muted">
            {decided.map((d) => (
              <li key={d.id}>
                <span className="mr-2 tabular-nums">{d.decided_at.slice(5, 10)}</span>
                <span className="text-ink">{d.status === "done" ? "Done" : d.choice}</span>
                {" · "}
                {d.text}
                {d.note ? <span className="italic"> · “{d.note}”</span> : null}
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
        <details id="decisions" className="scroll-mt-24 rounded-lg border border-line bg-panel px-3 py-2">
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
