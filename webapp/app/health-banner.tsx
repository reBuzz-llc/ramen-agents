import { health } from "@/lib/health-read";
import { readSeen, unseen } from "@/lib/health-seen";
import { quietDuringTrial } from "@/lib/trial";
import { readTrial } from "@/lib/trial-read";
import SeenButton from "./seen-button";

/** A red box when something needs a human (creatorCC queue 5); nothing when all is well. One line per issue, each with
 *  a Seen button that hides it until its fact changes (queue 54). Streamed in a Suspense boundary by its pages, so the
 *  reads never hold the page up. */
export default async function HealthBanner({
  className = "",
}: {
  className?: string;
}) {
  const [all, seen, trial] = await Promise.all([health().catch(() => []), readSeen().catch(() => ({})), readTrial().catch(() => null)]);
  // a planned pause (queue 371): the Validator not running and the bots idle are on purpose, not for a human
  const issues = unseen(quietDuringTrial(all, trial), seen);
  if (!issues.length) return null;
  return (
    <div className={className}>
      <div
        role="alert"
        className="rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-sm text-bad"
      >
        <b>Needs a human:</b>
        <ul className="mt-1 space-y-1">
          {issues.map((i) => (
            <li key={i.id} className="flex items-start justify-between gap-3">
              <span className="min-w-0">{i.text}</span>
              <SeenButton id={i.id} text={i.text} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
