import PixelLoader from "@/app/pixel-loader";

// Shown at once while the page's data is read, so the frame and navigation never wait on the database.
export default function Loading() {
  return (
    <div aria-busy="true" className="space-y-4">
      <div className="animate-pulse h-7 w-48 rounded-lg bg-panel" />
      <div className="animate-pulse h-4 w-80 max-w-full rounded bg-panel" />
      <div className="animate-pulse h-28 rounded-xl border border-line bg-panel" />
      <div className="animate-pulse h-28 rounded-xl border border-line bg-panel" />
      <PixelLoader label="Loading this page from the database…" />
    </div>
  );
}
