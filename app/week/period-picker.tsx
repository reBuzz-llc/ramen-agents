import Link from "next/link";
import { PERIOD_KEYS, PERIOD_LABEL, type Period } from "@/lib/periods";

/** Which period the page shows. The choice lives in the address, so a view can be bookmarked or shared. */
/** An arrow at either end of the row: the same kind of period one step back or on (lib/periods.ts periodLinks). */
function Step({ href, dir }: { href: string | null; dir: "prev" | "next" }) {
  const look = "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border px-3 text-sm";
  const words = dir === "prev" ? "Previous" : "Next";
  if (!href)
    return (
      <span aria-disabled="true" title="This is the latest" className={`${look} border-line text-muted opacity-50`} data-period-next-off>
        <span aria-hidden="true">→</span>
        <span className="sr-only">{words} (this is the latest)</span>
      </span>
    );
  return (
    <Link href={href} prefetch={false} className={`${look} border-line bg-panel hover:border-accent`} data-period-step={dir}>
      <span aria-hidden="true">{dir === "prev" ? "←" : "→"}</span>
      <span className="sr-only">{words}</span>
    </Link>
  );
}

export default function PeriodPicker({ period, steps }: { period: Period; steps?: { prev: string; next: string | null } }) {
  const chip = (on: boolean) => `inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 text-sm whitespace-nowrap ${on ? "border-accent bg-accent-tint font-semibold text-accent-ink" : "border-line bg-panel text-muted hover:text-ink"}`;
  return (
    <div data-period-picker className="mt-4">
      <div className="flex items-start gap-2">
      {steps ? <Step href={steps.prev} dir="prev" /> : null}
      <nav aria-label="Period" className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
        {PERIOD_KEYS.filter((k) => k !== "range").map((k) => (
          <Link key={k} href={k === "week" ? "/week" : `/week?p=${k}`} prefetch={false} aria-current={period.key === k ? "page" : undefined} className={chip(period.key === k)}>
            {PERIOD_LABEL[k]}
          </Link>
        ))}
      </nav>
      {steps ? <Step href={steps.next} dir="next" /> : null}
      </div>
      <form action="/week" method="get" aria-label="Date range" className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="p" value="range" />
        <label className="text-xs text-muted">
          From
          <input type="date" name="from" required defaultValue={period.fromDay} className="mt-1 block min-h-11 rounded-lg border border-line bg-bg px-2 text-sm text-ink" />
        </label>
        <label className="text-xs text-muted">
          To
          <input type="date" name="to" required defaultValue={period.toDay} className="mt-1 block min-h-11 rounded-lg border border-line bg-bg px-2 text-sm text-ink" />
        </label>
        <button className={chip(period.key === "range")}>Show range</button>
      </form>
      {period.problem ? <p role="alert" className="mt-2 text-sm text-bad">{period.problem}</p> : null}
    </div>
  );
}
