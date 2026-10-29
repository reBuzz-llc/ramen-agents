import { health } from "@/lib/health-read";

/** One red line when something needs a human (creatorCC queue 5); nothing when all is well. Streamed in a Suspense
 *  boundary by its pages, so the reads never hold the page up. */
export default async function HealthBanner({
  className = "",
}: {
  className?: string;
}) {
  const issues = await health().catch(() => []);
  if (!issues.length) return null;
  return (
    <div className={className}>
      <div
        role="alert"
        className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad"
      >
        <b>Needs a human:</b> {issues.map((i) => i.text).join(" ")}
      </div>
    </div>
  );
}
