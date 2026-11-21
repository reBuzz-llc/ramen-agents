import Link from "next/link";
import { answersOf, familyMissing, readFamily } from "@/lib/family";
import SetupForm from "./setup-form";

export const metadata = { title: "Your family · Bot Dashboard" };
export const dynamic = "force-dynamic";

// The first-run page: the questions sh scripts/setup.sh asks, saved to the same git-ignored file,
// common-data/local/family.toml. The agents read it on their next cycle; starting them stays with sh scripts/setup.sh.
export default async function SetupPage() {
  const f = await readFamily();
  const missing = familyMissing(f);
  return (
    <main className="mx-auto max-w-2xl px-4 pt-[calc(env(safe-area-inset-top)+3rem)] pb-24">
      <p className="text-sm text-muted">
        <Link href="/" className="hover:underline">
          ← Family
        </Link>
      </p>
      <h1 className="mt-3 text-2xl font-bold">Your family</h1>
      <p className="mt-2 text-sm text-muted">
        Who you are and who you sell to. Every agent&apos;s card is written around these answers. They are saved on this Mac in
        common-data/local/family.toml, which git never sees, so updating the starter never touches them. Change them here
        or with <code className="font-mono text-xs">sh scripts/setup.sh</code> any time.
      </p>
      {missing.length ? <p className="mt-3 text-sm text-ink">Still needed: {missing.join(", ")}.</p> : null}
      <SetupForm initial={answersOf(f)} />
    </main>
  );
}
