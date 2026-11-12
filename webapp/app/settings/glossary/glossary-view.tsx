"use client";
import { useState } from "react";
import { filterGlossary, type GlossarySection } from "@/lib/glossary";
import { Panel } from "../../ui";

/** The glossary's sections with a search across all of them (creatorCC queue 488). */
export default function GlossaryView({ sections }: { sections: GlossarySection[] }) {
  const [q, setQ] = useState("");
  const shown = filterGlossary(sections, q);
  const count = shown.reduce((n, s) => n + s.items.length, 0);
  return (
    <div className="space-y-4">
      <div className="sticky top-2 z-10">
        <label className="sr-only" htmlFor="glossary-search">
          Search the glossary
        </label>
        <input
          id="glossary-search"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search names and meanings, e.g. tick, portal, LD21"
          autoComplete="off"
          className="w-full rounded-xl bg-fill-3 px-4 py-2.5 text-base text-ink shadow-sm placeholder:text-muted focus:ring-2 focus:ring-sys-blue/40 focus:outline-none"
        />
        {q.trim() ? (
          <p role="status" className="mt-1 px-1 text-xs text-muted">
            {count ? `${count} match${count === 1 ? "" : "es"}` : "Nothing matches. Try one word."}
          </p>
        ) : null}
      </div>
      {shown.map((s) => (
        <Panel key={s.title} title={s.title}>
          <dl className="divide-y divide-line">
            {s.items.map((i) => (
              <div key={i.term} className="py-2.5">
                <dt className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className="font-semibold break-words text-ink">{i.term}</span>
                  {i.since ? <span className="text-xs text-muted tabular-nums">since {i.since}</span> : null}
                </dt>
                <dd className="mt-0.5 text-sm break-words text-ink/80">{i.what}</dd>
              </div>
            ))}
          </dl>
        </Panel>
      ))}
    </div>
  );
}
