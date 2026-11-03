import { NOTICE, NOTICE_VERSION } from "@/lib/notice";

export const metadata = { title: "Privacy · ramen-agents" };

/** What this version records and never records. The same text every person acknowledges at /welcome. */
export default function Privacy() {
  return (
    <article className="max-w-2xl space-y-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Privacy, in plain English</h1>
      <p>{NOTICE.intro}</p>
      <h2 className="pt-2 text-lg font-semibold">What it records</h2>
      <ul className="list-disc space-y-1 pl-5">{NOTICE.records.map((r) => <li key={r}>{r}</li>)}</ul>
      <h2 className="pt-2 text-lg font-semibold">The desktop tracker</h2>
      <p className="rounded-lg bg-panel p-3">{NOTICE.trackerStatus}</p>
      <p>When your company turns it on, it records:</p>
      <ul className="list-disc space-y-1 pl-5">{NOTICE.tracker.map((r) => <li key={r}>{r}</li>)}</ul>
      <h2 className="pt-2 text-lg font-semibold">What it never does</h2>
      <ul className="list-disc space-y-1 pl-5">{NOTICE.never.map((r) => <li key={r}>{r}</li>)}</ul>
      <h2 className="pt-2 text-lg font-semibold">Who sees it</h2>
      <p>{NOTICE.who}</p>
      <h2 className="pt-2 text-lg font-semibold">Keeping and deleting</h2>
      <p>{NOTICE.keep}</p>
      <p className="pt-4 text-xs text-muted">Notice version {NOTICE_VERSION}. This is not legal advice; your employer is responsible for the notice the law requires where you work.</p>
    </article>
  );
}
