// Shown at once while each bot's database is read.
export default function Loading() {
  return (
    <main aria-busy="true" className="mx-auto max-w-6xl animate-pulse px-4 py-6">
      <div className="h-7 w-48 rounded-lg bg-panel" />
      <div className="mt-5 h-72 rounded-xl bg-panel" />
      <div className="mt-5 h-24 rounded-xl bg-panel" />
      <span className="sr-only">Reading the family…</span>
    </main>
  );
}
