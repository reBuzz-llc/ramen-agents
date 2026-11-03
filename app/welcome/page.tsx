import { redirect } from "next/navigation";
import { btnPrimary } from "@/lib/ui-classes";
import { me } from "@/lib/auth";
import { NOTICE, NOTICE_VERSION } from "@/lib/notice";
import { safeNext, withNext } from "@/lib/return-path";

// Reads the session cookie: never prerendered.
export const dynamic = "force-dynamic";

export const metadata = { title: "Welcome · ramen-agents" };

/** Onboarding: read what ramen-agents records, and acknowledge it (stored with the date) before anything else. */
export default async function Welcome(props: PageProps<"/welcome">) {
  const next = safeNext((await props.searchParams).next);
  const who = await me();
  if (!who) redirect(withNext("/sign-in", next));
  if (who.acked) redirect(next ?? "/");
  return (
    <div className="max-w-2xl space-y-4 text-sm leading-relaxed">
      <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Before you start</h1>
      <p>{who.tenantName} uses ramen-agents to track your paid work hours. Please read what it records about you.</p>
      <p>{NOTICE.intro}</p>
      <h2 className="pt-2 text-lg font-semibold">What it records</h2>
      <ul className="list-disc space-y-1 pl-5">{NOTICE.records.map((r) => <li key={r}>{r}</li>)}</ul>
      <h2 className="pt-2 text-lg font-semibold">The desktop tracker</h2>
      <p className="rounded-lg bg-panel p-3">{NOTICE.trackerStatus}</p>
      <p>When your company turns it on, it records:</p>
      <ul className="list-disc space-y-1 pl-5">{NOTICE.tracker.map((r) => <li key={r}>{r}</li>)}</ul>
      <h2 className="pt-2 text-lg font-semibold">What it never does</h2>
      <ul className="list-disc space-y-1 pl-5">{NOTICE.never.map((r) => <li key={r}>{r}</li>)}</ul>
      <p>{NOTICE.who}</p>
      <p>{NOTICE.keep}</p>
      <form action="/api/acknowledge" method="post" className="rounded-xl border border-line bg-panel p-4">
        <label className="flex items-start gap-2">
          <input type="checkbox" name="ok" required className="mt-1" />
          {next ? <input type="hidden" name="next" value={next} /> : null}
          <span>I have read this notice (version {NOTICE_VERSION}) from {who.tenantName}.</span>
        </label>
        <button className={`${btnPrimary} mt-3`}>Acknowledge and continue</button>
        <p className="mt-2 text-xs text-muted">Your acknowledgment is kept with today&apos;s date. Nothing else is recorded until you continue.</p>
      </form>
    </div>
  );
}
