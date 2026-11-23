import type { Okr } from "@/lib/family-stats";

/** This week's objective and key results, with the Validator's progress line under each. */
export default function KeyResults({ okr }: { okr: Okr }) {
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="text-sm text-ink">
        <b>This week{okr.week ? ` (${okr.week})` : ""}:</b> {okr.objective || <span className="text-muted">no objective written</span>}
      </p>
      <ol className="mt-1 space-y-1 text-sm">
        {okr.krs.map((k, i) => (
          <li key={i}>
            <span className="text-ink">KR{i + 1}.</span> <span className="text-muted">{k.text || "(empty)"}</span>
            {k.progress ? <span className="block pl-8 text-xs text-ink">{k.progress}</span> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
