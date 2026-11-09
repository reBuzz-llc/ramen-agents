import Link from "next/link";
import { leadPath } from "@/lib/deep-links";
import type { SampleToMake } from "@/lib/samples-to-make";

/** The pain point's first line, without its "Pain point:" label: what the sample should answer. */
const gap = (p: string | null) => (p ?? "").split("\n")[0].replace(/^\s*pain point\s*:\s*/i, "").trim();

/** "Samples to make" on the Clock: the person's answered Starter Website leads with no sample yet. */
export default function SamplesToMake({ rows }: { rows: SampleToMake[] }) {
  if (!rows.length) return null;
  return (
    <section aria-labelledby="samples-to-make" className="mt-10">
      <h2 id="samples-to-make" className="text-lg font-semibold">
        Samples to make <span className="text-sm font-normal text-muted tabular-nums">{rows.length}</span>
      </h2>
      <p className="mt-1 text-sm text-muted">
        These answered your Starter Website note. Make each one&apos;s sample site before the meeting, then paste its link in the lead&apos;s <span className="font-semibold">Sample site</span> cell; the lead leaves this list.
      </p>
      <ul className="mt-3 space-y-2">
        {rows.map((l) => (
          <li key={l.id} className="rounded-xl border border-line bg-panel p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="font-semibold">{l.business}</span>
              <span className="text-xs text-muted">
                {l.result === "Meeting" ? "Meeting booked" : "Replied"}
                {l.resultDate ? `, ${l.resultDate}` : ""}
              </span>
            </div>
            {l.location ? <p className="text-xs text-muted">{l.location}</p> : null}
            {gap(l.painPoint) ? <p className="mt-1 line-clamp-3">{gap(l.painPoint)}</p> : null}
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Link href={leadPath(l.id)} className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm font-semibold hover:border-accent">
                Open lead
              </Link>
              {l.link ? (
                <a href={l.link} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center text-sm text-accent-ink hover:underline">
                  {/maps|goo\.gl/i.test(l.link) ? "Their listing" : "Their website"}
                </a>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
