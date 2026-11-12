import { tickLine, type Tick } from "@/lib/tick";

/** "Last tick 15:49 (3 min ago)" in muted text; a red line when the Validator has not reported for over 30 minutes
 *  (creatorCC queue 315), so stale numbers on the provider pages are never mistaken for live ones. */
export default function TickLine({ tick, className = "" }: { tick: Tick; className?: string }) {
  return tick.stale ? (
    <p role="alert" data-tick="stale" className={`rounded-lg border-l-4 border-bad bg-bad/10 px-3 py-2 text-sm font-medium text-bad ${className}`}>
      {tickLine(tick)}
    </p>
  ) : (
    <p data-tick="ok" className={`text-xs text-muted tabular-nums ${className}`}>
      {tickLine(tick)}
    </p>
  );
}
