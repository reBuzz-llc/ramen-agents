import { tone } from "@/lib/lead-workflow";

/** A status's colour group as chip classes (the words are always shown too). */
export const CHIP: Record<ReturnType<typeof tone>, string> = {
  good: "bg-good/15 text-good",
  bad: "bg-bad/15 text-bad",
  go: "bg-accent-tint text-accent-ink",
  wait: "bg-line text-ink",
  none: "",
};

export function Chip({ status }: { status: string | null }) {
  if (!status) return null;
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${CHIP[tone(status)]}`}
    >
      {status}
    </span>
  );
}
