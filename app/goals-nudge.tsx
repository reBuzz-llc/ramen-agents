import Link from "next/link";
import { showGoalsNudge } from "@/lib/goals-nudge";
import type { Role } from "@/lib/roles";

/** One line for the owner while no key results are set: on the Clock home and on This week. */
export default function GoalsNudge({ role, keyResults, className = "" }: { role: Role; keyResults: Parameters<typeof showGoalsNudge>[1]; className?: string }) {
  if (!showGoalsNudge(role, keyResults)) return null;
  return (
    <p data-nudge="goals" className={`rounded-lg border-l-4 border-accent bg-panel px-3 py-2 text-sm ${className}`}>
      No goals for this week yet, so the Guide and This week have nothing to measure against.{" "}
      <Link href="/settings/company#krs" className="font-semibold text-accent hover:underline">
        Set this week&apos;s goals → Settings → Company
      </Link>
    </p>
  );
}
