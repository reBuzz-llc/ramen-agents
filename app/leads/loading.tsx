import PixelLoader from "@/app/pixel-loader";

// Shown at once while the leads are read: the frame, and after ~300 ms the loading orb with what loads.
export default function Loading() {
  return (
    <div aria-busy="true" className="space-y-4">
      <div className="h-7 w-48 animate-pulse rounded-lg bg-panel" />
      <PixelLoader label="Loading the leads from the database…" />
      <div className="h-28 animate-pulse rounded-xl border border-line bg-panel" />
      <div className="h-28 animate-pulse rounded-xl border border-line bg-panel" />
    </div>
  );
}
