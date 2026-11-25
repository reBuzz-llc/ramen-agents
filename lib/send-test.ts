// The sample link test: does the sample link work better in the first message, or after a reply?
// Pure, so the pack cards, the drawer, the store and the result page share one set of rules. Lead data only: nothing here
// knows who sent what.

export const CHANNELS = ["email", "whatsapp"] as const;
export type Channel = (typeof CHANNELS)[number];
export type Assigned = "link_first" | "after_reply";
export type Variant = Assigned | "no_sample" | "off_test";

export const VARIANT_LABEL: Record<Variant, string> = {
  link_first: "Link in first message",
  after_reply: "Link after reply",
  no_sample: "No sample",
  off_test: "Off the test",
};

/** Under this many sends in either variant the page says "too few to tell". */
export const MIN_SENDS = 30;
/** Stricter than the usual 0.05, because this page is read again and again while the counts grow. */
export const CLEAR_P = 0.01;
export const METHOD = `Method: Fisher's exact test, two-sided. A difference is clear at p < ${CLEAR_P} with at least ${MIN_SENDS} sends in each variant.`;

/** A person answered: "Not interested" is an answer too. Bounced is not. */
export const REPLY_RESULTS = ["Replied", "Meeting", "Client", "Not interested"];
export const hasReplied = (result: unknown) => typeof result === "string" && REPLY_RESULTS.includes(result);

/** The link that may go in this message. Once they replied, always. Before: never on WhatsApp (a link in a cold WhatsApp
 *  adds ban risk), and on email unless the lead is in the after-reply group. */
export function firstMessageLink(channel: Channel, url: string | null | undefined, variant: Assigned | null | undefined, result: unknown): string | null {
  const link = (url ?? "").trim();
  if (!link) return null;
  if (hasReplied(result)) return link;
  if (channel === "whatsapp" || variant === "after_reply") return null;
  return link;
}

/** The group a send is logged under. A lead with no public link is no-sample; a send the test cannot vouch for (marked after
 *  the fact, no group, or a draft already holding a link it should not) stays out of the comparison. */
export function sendVariant(s: { channel: Channel; url: string | null | undefined; assigned: Assigned | null | undefined; draft: string | null | undefined; past?: boolean }): Variant {
  const link = (s.url ?? "").trim();
  if (!link) return "no_sample";
  if (s.past) return "off_test";
  const held = s.channel === "whatsapp" || s.assigned === "after_reply";
  if (held && (s.draft ?? "").includes(link)) return "off_test";
  if (s.channel === "whatsapp") return "after_reply";
  return s.assigned ?? "off_test";
}

/** Alternating by lead: whichever group has fewer leads, link-first on a tie. */
export const nextVariant = (linkFirst: number, afterReply: number): Assigned => (linkFirst <= afterReply ? "link_first" : "after_reply");

export type SendOutcome = { id: string; channel: string; repliedAt: Date | null; closedAt: Date | null; result: string | null; amountCents: number | null };
export type OutcomePatch = Pick<SendOutcome, "repliedAt" | "closedAt" | "result" | "amountCents">;

/** What each send of a lead should hold, given the lead's one Result. With sends on both channels the reply belongs to the one
 *  a person named; until then both carry the result with no reply time, and the page counts it as "channel not said". */
export function settleOutcome(rows: SendOutcome[], result: string | null | undefined, chosen: Channel | null | undefined, now: Date): Map<string, OutcomePatch> {
  const empty: OutcomePatch = { repliedAt: null, closedAt: null, result: null, amountCents: null };
  const out = new Map<string, OutcomePatch>();
  if (result === "Bounced") {
    for (const r of rows) out.set(r.id, r.channel === "email" ? { ...empty, result } : empty);
    return out;
  }
  if (!hasReplied(result)) {
    for (const r of rows) out.set(r.id, empty);
    return out;
  }
  const target = (chosen ? rows.find((r) => r.channel === chosen) : undefined) ?? rows.find((r) => r.repliedAt) ?? (rows.length === 1 ? rows[0] : undefined);
  for (const r of rows) {
    if (!target) out.set(r.id, { ...empty, result: result as string });
    else if (r.id !== target.id) out.set(r.id, empty);
    else {
      const won = result === "Client";
      out.set(r.id, { repliedAt: r.repliedAt ?? now, closedAt: won ? (r.closedAt ?? now) : null, result: result as string, amountCents: won ? r.amountCents : null });
    }
  }
  return out;
}

/** An amount as a person types it ("1,200", "$1200.50"): cents; null when blank; "bad" when it is not an amount. */
export function parseAmount(v: unknown): number | null | "bad" {
  if (v === null || v === undefined) return null;
  const s = String(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return "bad";
  const cents = Math.round(Number(s) * 100);
  return cents <= 100_000_000 ? cents : "bad";
}

/** Two-sided Fisher's exact test on [[a, b], [c, d]]: the chance of a table at least this unlikely, the margins fixed. */
export function fisherP(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  const lf = new Float64Array(n + 1);
  for (let i = 2; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
  const r1 = a + b;
  const r2 = c + d;
  const c1 = a + c;
  const lp = (x: number) => lf[r1] + lf[r2] + lf[c1] + lf[n - c1] - lf[n] - lf[x] - lf[r1 - x] - lf[c1 - x] - lf[r2 - c1 + x];
  const seen = lp(a);
  let p = 0;
  for (let x = Math.max(0, c1 - r2); x <= Math.min(r1, c1); x++) {
    const l = lp(x);
    if (l <= seen + 1e-7) p += Math.exp(l);
  }
  return Math.min(1, p);
}

export type Verdict = { kind: "few" } | { kind: "none"; p: number } | { kind: "clear"; p: number; better: "first" | "second" };

/** The two variants' hits out of sends: too few to tell, no clear difference yet, or a clear one. */
export function verdict(hits1: number, sends1: number, hits2: number, sends2: number): Verdict {
  if (sends1 < MIN_SENDS || sends2 < MIN_SENDS) return { kind: "few" };
  const p = fisherP(hits1, sends1 - hits1, hits2, sends2 - hits2);
  if (p >= CLEAR_P) return { kind: "none", p };
  return { kind: "clear", p, better: hits1 / sends1 > hits2 / sends2 ? "first" : "second" };
}

export type Bucket = { sends: number; replies: number; closes: number; amountCents: number; bounced: number };
export type SendRow = { leadId: string; channel: string; variant: string; repliedAt: Date | null; closedAt: Date | null; result: string | null; amountCents: number | null };

/** The counts per channel and variant. A bounced send never arrived, so it is counted apart and not as a send. */
export function summarise(rows: SendRow[]): { buckets: Map<string, Bucket>; channelNotSaid: number } {
  const buckets = new Map<string, Bucket>();
  const unsaid = new Set<string>();
  for (const r of rows) {
    const key = `${r.channel}:${r.variant}`;
    const b = buckets.get(key) ?? { sends: 0, replies: 0, closes: 0, amountCents: 0, bounced: 0 };
    buckets.set(key, b);
    if (r.result === "Bounced") {
      b.bounced++;
      continue;
    }
    b.sends++;
    if (r.repliedAt) b.replies++;
    else if (hasReplied(r.result)) unsaid.add(r.leadId);
    if (r.closedAt) {
      b.closes++;
      b.amountCents += r.amountCents ?? 0;
    }
  }
  return { buckets, channelNotSaid: unsaid.size };
}

/** "3 of 40 (7.5%)": the count always beside the percent. */
export function countAndPercent(hits: number, sends: number): string {
  if (!sends) return "0 of 0";
  const pct = (hits / sends) * 100;
  return `${hits} of ${sends} (${pct < 10 && pct > 0 ? pct.toFixed(1) : Math.round(pct)}%)`;
}
