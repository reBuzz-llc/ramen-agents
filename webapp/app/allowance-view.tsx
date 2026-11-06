"use client";
// The Allowance list (the goal "drain every free token"): each provider in the
// family's chain with today's calls and tokens against its cap, a thin meter, what is left today, and its last good and
// failed answer; monthly tiers show today's paced share (what is left this month / days left). Then the keyed providers
// that are not in the chain, with their last use. Names only, never a key. A link to #allowance opens it.
import type { Allowance, ChainRow } from "@/lib/allowance";
import { usePoll } from "./hooks";
import { Panel } from "./ui";

const big = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString());
const hm = (iso: string | null) => (iso ? iso.slice(5, 16).replace("T", " ") : "never");

const STATUS: Record<ChainRow["status"], { label: string; cls: string; bar: string }> = {
  ok: { label: "answering", cls: "text-muted", bar: "bg-accent" },
  idle: { label: "not used today", cls: "text-muted", bar: "bg-accent" },
  near: { label: "above 90%", cls: "font-semibold text-ink", bar: "bg-[#d97706]" },
  dead: { label: "not answering", cls: "font-semibold text-bad", bar: "bg-bad" },
};

function Meter({ used, status }: { used: number | null; status: ChainRow["status"] }) {
  if (used === null) return <span className="text-xs text-muted">no cap</span>;
  const pct = Math.min(100, Math.round(used * 100));
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-24 overflow-hidden rounded-full bg-fill" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label="Share of today's allowance used">
        <span className={`block h-full rounded-full ${STATUS[status].bar}`} style={{ width: `${pct}%` }} />
      </span>
      <span className="w-9 text-right text-xs tabular-nums text-muted">{pct}%</span>
    </span>
  );
}

function tokensCell(r: ChainRow): string {
  const t = r.tokenLimit;
  if (!t) return big(r.tokens);
  if (t.per === "day") return t.limit ? `${big(r.tokens)} of ${big(t.limit)}` : big(r.tokens);
  if (!t.limit) return `${big(r.tokens)} (${big(t.monthUsed ?? 0)} this month)`;
  return `${big(r.tokens)} of ${big(t.pacedToday ?? 0)} paced`;
}

function leftCell(r: ChainRow): string {
  const parts = [];
  if (r.left.calls !== null) parts.push(`${r.left.calls.toLocaleString()} calls`);
  if (r.left.tokens !== null) parts.push(`${big(r.left.tokens)} tokens`);
  return parts.join(" · ") || "no cap";
}

export default function AllowanceView() {
  const poll = usePoll<Allowance>("allowance", 60000);
  const a = poll.data;
  return (
    <div id="allowance" className="mt-6 scroll-mt-24 space-y-3">
      <Panel
        title="Allowance"
        aside={a ? `today, ${a.day}` : null}
        hint="Every free tier in the family's chain, to use up before it resets. Calls against the day's cap, tokens against the tier where it is token-bound (a monthly tier: today's paced share, what is left this month over the days left)."
      >
        {!a ? (
          <p className="text-sm text-muted">{poll.error ?? "Reading the allowance…"}</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1.5 pr-3 font-medium">Provider</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Calls today</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Tokens today</th>
                  <th className="py-1.5 pr-3 font-medium">Used</th>
                  <th className="py-1.5 pr-3 font-medium">Left today</th>
                  <th className="py-1.5 font-medium">Last answer</th>
                </tr>
              </thead>
              <tbody>
                {a.chain.map((r) => (
                  <tr key={r.name} className="border-t border-line align-top">
                    <td className="py-2 pr-3">
                      <p className="font-medium text-ink">{r.name}</p>
                      <p className={`text-xs ${STATUS[r.status].cls}`}>
                        {/* a dead row's note already says how long; the others get the status word first */}
                        {r.status === "dead" && r.note ? r.note : [STATUS[r.status].label, r.note].filter(Boolean).join(" · ")}
                      </p>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {r.calls.toLocaleString()}
                      {r.callsCap ? <span className="text-muted"> of {r.callsCap.toLocaleString()}</span> : null}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{tokensCell(r)}</td>
                    <td className="py-2 pr-3">
                      <Meter used={r.used} status={r.status} />
                    </td>
                    <td className="py-2 pr-3 tabular-nums">{leftCell(r)}</td>
                    <td className="py-2 text-xs tabular-nums text-muted">
                      ok {hm(r.health.lastOk)}
                      <br />
                      fail {hm(r.health.lastFail)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {a ? (
        <Panel title="Keyed, not in the chain" hint="Keys on file that the chain does not use: the search backups, the email verifiers, and model providers out of the chain. Their last recorded use.">
          <div className="-mx-4 overflow-x-auto px-4">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1.5 pr-3 font-medium">Provider</th>
                  <th className="py-1.5 pr-3 font-medium">Kind</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Today</th>
                  <th className="py-1.5 pr-3 font-medium">Allowance</th>
                  <th className="py-1.5 font-medium">Last use</th>
                </tr>
              </thead>
              <tbody>
                {a.idle.map((r) => (
                  <tr key={r.name} className="border-t border-line align-top">
                    <td className="py-2 pr-3">
                      <p className="font-medium text-ink">{r.name}</p>
                      {r.note ? <p className="text-xs text-muted">{r.note}</p> : null}
                    </td>
                    <td className="py-2 pr-3 text-muted">{r.kind}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{r.today === null ? "—" : r.today}</td>
                    <td className="py-2 pr-3 text-muted">{r.cap || "—"}</td>
                    <td className="py-2 tabular-nums text-muted">{r.lastUse ?? (a.since ? `none recorded since ${a.since}` : "none recorded")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-muted">&ldquo;—&rdquo;: no use recorded today, or no allowance on file.</p>
        </Panel>
      ) : null}
    </div>
  );
}
