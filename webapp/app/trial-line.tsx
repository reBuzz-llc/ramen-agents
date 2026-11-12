import { readTrial } from "@/lib/trial-read";

/** One calm line while a planned pause runs (creatorCC queue 371): under the world and the list view. */
export default async function TrialLine({ className = "" }: { className?: string }) {
  const trial = await readTrial().catch(() => null);
  if (!trial) return null;
  return (
    <p role="status" data-trial="on" className={`rounded-lg border border-line bg-panel px-3 py-2 text-sm text-muted ${className}`}>
      {trial.line}.
    </p>
  );
}
