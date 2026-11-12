"use client";
// The Allowance list (creatorCC queue 230, the owner's standing goal "drain every free token"): each provider in the
// family's chain with today's calls and tokens against its cap, a thin meter, what is left today, and its last good and
// failed answer; monthly tiers show today's paced share (what is left this month / days left). Then the keyed providers
// that are not in the chain, with their last use. Names only, never a key. The world's ticker links here (#allowance)
// while a provider is dead or above 90%.
import type { Allowance, ChainRow } from "@/lib/allowance";
import { usePoll } from "./hooks";
import { pausedTick, tickOf } from "@/lib/tick";
import TickLine from "./tick-line";
import { Panel } from "./ui";
import SortableTable from "./sortable-table";

const big = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1e3)}K` : n.toLocaleString());
const hm = (iso: string | null) => (iso ? iso.slice(5, 16).replace("T", " ") : "never");

const STATUS: Record<ChainRow["status"], { label: string; cls: string; bar: string }> = {
  ok: { label: "answering", cls: "text-muted", bar: "bg-accent" },
  idle: { label: "not used today", cls: "text-muted", bar: "bg-accent" },
  near: { label: "above 90%", cls: "font-semibold text-ink", bar: "bg-[#d97706]" },
  dead: { label: "not answering", cls: "font-semibold text-bad", bar: "bg-bad" },
  spent: { label: "allowance spent", cls: "font-semibold text-ink", bar: "bg-muted" },
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
      {a ? <TickLine tick={pausedTick(tickOf(a.tickAt ?? null, Date.parse(a.at)), a.paused)} /> : null}
      <Panel
        title="Allowance"
        aside={a ? `today, ${a.day}` : null}
        hint="Every free tier in the family's chain, to use up before it resets. Calls against the day's cap, tokens against the tier where it is token-bound (a monthly tier: today's paced share, what is left this month over the days left)."
      >
        {!a ? (
          <p className="text-sm text-muted">{poll.error ?? "Reading the allowance…"}</p>
        ) : (
          <div className="-mx-4 overflow-x-auto px-4">
            <SortableTable className="w-full min-w-[46rem] text-sm">
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
                        {(r.status === "dead" || r.status === "spent") && r.note ? r.note : [STATUS[r.status].label, r.note].filter(Boolean).join(" · ")}
                      </p>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {r.calls.toLocaleString()}
                      {r.callsCap ? <span className="text-muted"> of {r.callsCap.toLocaleString()}</span> : null}
                      {/* who drained it (queue 286): the bots and the Validator's own jobs share these keys */}
                      {r.calls ? (
                        <span className="block text-[11px] whitespace-nowrap text-muted">
                          {r.split ? `bots ${r.split.bots.toLocaleString()} · Validator jobs ${r.split.validator.toLocaleString()}` : "no split yet"}
                        </span>
                      ) : null}
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
            </SortableTable>
          </div>
        )}
      </Panel>
      {a ? (
        <Panel title="Keyed, not in the chain" hint="Keys on file that the chain does not use: the search backups, the email verifiers, and model providers out of the chain. Their last recorded use.">
          <div className="-mx-4 overflow-x-auto px-4">
            <SortableTable className="w-full min-w-[36rem] text-sm">
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
            </SortableTable>
          </div>
          <p className="mt-2 text-xs text-muted">&ldquo;—&rdquo;: no use recorded today, or no allowance on file (Tavily: the CEO&rsquo;s special searches, no daily number).</p>
        </Panel>
      ) : null}
      {/* queue 304: every other free limit the family can hit; "not measurable" with the reason, never a guess */}
      <Panel
        title="Other free tiers"
        hint={`Hosting, the databases, file storage and training. Checked hourly by scripts/free-tiers.py${a?.otherAt ? `, last ${a.otherAt.slice(11, 16)}` : " (not run yet)"}; the dashboard holds no key. The ticker warns from 80%.`}
      >
        {a?.other?.length ? (
          <div className="-mx-4 overflow-x-auto px-4">
            <SortableTable className="w-full min-w-[40rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1.5 pr-3 font-medium">Service</th>
                  <th className="py-1.5 pr-3 text-right font-medium">Used</th>
                  <th className="py-1.5 pr-3 font-medium">Limit</th>
                  <th className="py-1.5 pr-3 font-medium">Resets</th>
                  <th className="py-1.5 font-medium">How we know</th>
                </tr>
              </thead>
              <tbody>
                {a.other.map((r) => (
                  <tr key={`${r.name}-${r.what}`} className="border-t border-line align-top">
                    <td className="py-2 pr-3">
                      <p className="font-medium text-ink">{r.name}</p>
                      <p className="text-xs text-muted">{r.what}</p>
                    </td>
                    <td className="py-2 pr-3 text-right whitespace-nowrap tabular-nums">
                      {r.used === null ? (
                        <span className="text-muted">not measurable</span>
                      ) : (
                        <span className={r.status === "over" ? "font-semibold text-bad" : r.status === "near" ? "font-semibold text-sys-orange" : ""}>
                          {r.used.toLocaleString()}
                          {r.limit ? <span className="block text-[11px] font-normal text-muted">{Math.round((r.used / r.limit) * 100)}%</span> : null}
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap text-muted tabular-nums">
                      {r.limit === null ? "—" : `${r.limit.toLocaleString()} ${r.unit}`}
                    </td>
                    <td className="py-2 pr-3 text-xs text-muted">{r.resets}</td>
                    <td className="py-2 text-xs text-muted">{r.how}</td>
                  </tr>
                ))}
              </tbody>
            </SortableTable>
          </div>
        ) : (
          <p className="text-sm text-muted">Not checked yet: the hourly job (launchd com.rebuzz.free-tiers) writes common-data/shared-state/free-tiers.json.</p>
        )}
      </Panel>
    </div>
  );
}
