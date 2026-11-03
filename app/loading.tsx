// Shown at once while the page's data is read, so the frame and navigation never wait on the database.
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse space-y-4">
      <div className="h-7 w-48 rounded-lg bg-panel" />
      <div className="h-4 w-80 max-w-full rounded bg-panel" />
      <div className="h-28 rounded-xl border border-line bg-panel" />
      <div className="h-28 rounded-xl border border-line bg-panel" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
