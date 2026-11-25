type Week = { title: string; summary: string; url: string };

export const POST_UNAVAILABLE = "The public post is not available right now.";

/** The newest week: a link to its public post while that page answers, otherwise the same words with a plain line. */
export function WeekCard({ week, available }: { week: Week; available: boolean }) {
  const words = (
    <>
      <p className="font-semibold">{week.title}</p>
      {week.summary ? <p className="mt-1 text-sm text-muted">{week.summary}</p> : null}
    </>
  );
  if (!available) {
    return (
      <div data-family-week className="mt-3 rounded-xl border border-line bg-panel p-4">
        {words}
        <p className="mt-2 text-sm text-muted">{POST_UNAVAILABLE}</p>
      </div>
    );
  }
  return (
    <a data-family-week href={week.url} target="_blank" rel="noopener" className="mt-3 block rounded-xl border border-line bg-panel p-4 hover:border-accent">
      {words}
      <p className="mt-2 text-sm font-medium text-accent-ink">Read the week →</p>
    </a>
  );
}
