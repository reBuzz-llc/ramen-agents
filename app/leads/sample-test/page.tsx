import Link from "next/link";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { sampleTestResults } from "@/lib/lead-sends";
import { pageMe } from "@/lib/page-me";
import { can } from "@/lib/roles";
import { countAndPercent, METHOD, MIN_SENDS, VARIANT_LABEL, verdict, type Bucket, type Variant, type Verdict } from "@/lib/send-test";

export const metadata = { title: "Sample link test · Productive Peek" };

const EMPTY: Bucket = { sends: 0, replies: 0, closes: 0, amountCents: 0, bounced: 0 };
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

function VerdictLine({ what, v }: { what: string; v: Verdict }) {
  const text =
    v.kind === "few"
      ? `Too few to tell (under ${MIN_SENDS} sends in a variant)`
      : v.kind === "none"
        ? "No clear difference yet"
        : `Clear difference: ${VARIANT_LABEL[v.better === "first" ? "link_first" : "after_reply"]} got more`;
  return (
    <p className="text-sm">
      <span className="font-semibold">{what}: </span>
      {text}
    </p>
  );
}

function Card({ variant, b, note }: { variant: Variant; b: Bucket; note?: string }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-4" data-variant={variant}>
      <h3 className="font-semibold">{VARIANT_LABEL[variant]}</h3>
      {note ? <p className="text-xs text-muted">{note}</p> : null}
      <dl className="mt-3 space-y-1.5 text-sm tabular-nums">
        <div className="flex justify-between gap-3"><dt className="text-muted">Sends</dt><dd className="font-semibold">{b.sends}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">Replies</dt><dd>{countAndPercent(b.replies, b.sends)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">Closes</dt><dd>{countAndPercent(b.closes, b.sends)}</dd></div>
        <div className="flex justify-between gap-3"><dt className="text-muted">Amount won</dt><dd>{money(b.amountCents)}</dd></div>
      </dl>
    </section>
  );
}

/** Leads → Sample link test: does the link work better in the first message, or after a reply? Lead data only:
 *  this page reads the send log, which has no person in it. */
export default async function SampleTestPage() {
  const who = await pageMe("/leads/sample-test");
  if (!can(who.role, "week.team")) redirect("/leads");
  const { buckets, channelNotSaid, leadsInTest } = await sampleTestResults(await db(), who.tenantId);
  const of = (channel: string, variant: Variant) => buckets.get(`${channel}:${variant}`) ?? EMPTY;
  const first = of("email", "link_first");
  const after = of("email", "after_reply");
  const offTest = of("email", "off_test").sends + of("whatsapp", "off_test").sends;
  const bounced = [...buckets.values()].reduce((n, b) => n + b.bounced, 0);
  return (
    <div className="mx-auto max-w-3xl">
      <p className="text-sm">
        <Link href="/leads" className="inline-flex min-h-11 items-center text-accent-ink hover:underline">← Leads</Link>
      </p>
      <h1 className="mt-2 text-2xl font-bold tracking-tight sm:text-[1.75rem]">Sample link test</h1>
      <p className="mt-1 text-[0.9375rem] text-muted">Does the sample link work better in the first email, or after a reply? Peek picks the group for each lead, alternating.</p>
      <p className="mt-3 rounded-lg border-l-4 border-accent bg-accent-tint px-3 py-2 text-sm font-semibold">Replies count only when someone marks them.</p>
      {!leadsInTest ? <p className="mt-3 text-sm text-muted">No public sample links yet, so every send is logged as no sample. The test starts when samples go public.</p> : null}

      <h2 className="mt-6 text-lg font-semibold">Email: the comparison</h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Card variant="link_first" b={first} />
        <Card variant="after_reply" b={after} />
      </div>
      <div className="mt-3 space-y-1">
        <VerdictLine what="Replies" v={verdict(first.replies, first.sends, after.replies, after.sends)} />
        <VerdictLine what="Closes" v={verdict(first.closes, first.sends, after.closes, after.sends)} />
        <p className="text-xs text-muted">{METHOD}</p>
      </div>

      <h2 className="mt-6 text-lg font-semibold">Baseline</h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Card variant="no_sample" b={of("email", "no_sample")} note="Email to leads with no public sample. Not compared: these leads differ." />
      </div>

      <h2 className="mt-6 text-lg font-semibold">WhatsApp: logged, outside the comparison</h2>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <Card variant="after_reply" b={of("whatsapp", "after_reply")} note="Had a sample; the link waits for a reply." />
        <Card variant="no_sample" b={of("whatsapp", "no_sample")} />
      </div>

      {bounced || offTest || channelNotSaid ? (
        <ul className="mt-5 list-disc space-y-1 pl-5 text-sm text-muted">
          {bounced ? <li>{bounced} bounced, left out of the sends.</li> : null}
          {offTest ? <li>{offTest} sent outside the test (marked later, or the draft already held the link), left out.</li> : null}
          {channelNotSaid ? <li>{channelNotSaid} answered with no channel named, so not counted as a reply yet.</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
