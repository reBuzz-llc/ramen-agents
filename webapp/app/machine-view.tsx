"use client";

import type { BotMachine, MachineApp, MachineService } from "@/lib/machine";
import { duration, memory } from "@/lib/format";
import type { Tone } from "@/lib/status";
import { Badge } from "./ui";
import CopyButton from "./copy-button";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-3 first:border-0 first:pt-0">
      <h3 className="mb-2 text-sm font-semibold text-muted">{title}</h3>
      {children}
    </div>
  );
}

function Usage({ cpu, memMb, pids }: { cpu: number; memMb: number; pids?: number[] }) {
  return (
    <span className="group inline-flex items-center gap-1 font-mono text-xs text-muted tabular-nums">
      {memory(memMb)} · {cpu.toFixed(1)}% CPU{pids && pids.length ? ` · pid ${pids.join(", ")}` : ""}
      {pids && pids.length ? <CopyButton text={pids.join(" ")} what={pids.length === 1 ? "process id" : "process ids"} reveal /> : null}
    </span>
  );
}

const KIND_LABEL: Record<MachineApp["kind"], string> = {
  agent: "agent",
  supervisor: "supervisor",
  "keep-awake": "keep awake",
  driver: "driver",
  server: "data server",
  helper: "helper",
};

function serviceBadge(s: MachineService, botRunning: boolean): { tone: Tone; label: string } {
  if (!s.running) return { tone: "bad", label: "not running" };
  if (!botRunning || s.connected === null) return { tone: "muted", label: "running" };
  return s.connected ? { tone: "good", label: "in use now" } : { tone: "info", label: "running · idle" };
}

export default function MachineView({ machine, error }: { machine: BotMachine | null; error: string | null }) {
  if (!machine) {
    return <p className="text-sm text-muted">{error ? `Could not read this Mac’s processes: ${error}` : "Looking at this Mac…"}</p>;
  }
  if (machine.error) return <p className="text-sm text-muted">{machine.error}</p>;

  const b = machine.browser;
  const browserBadge: { tone: Tone; label: string } = b.open
    ? { tone: "good", label: b.processes.length ? "open" : "in use" }
    : machine.running
      ? { tone: "info", label: "closed" }
      : { tone: "muted", label: "not running" };

  return (
    <div className="space-y-4">
      <Section title="Browser">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-ink">{b.name}</p>
            <p className="text-xs text-muted">{b.detail}</p>
          </div>
          <Badge tone={browserBadge.tone}>{browserBadge.label}</Badge>
        </div>
        {b.closedReason && !b.open ? <p className="mt-1.5 text-xs text-muted">{b.closedReason}</p> : null}
        {b.processes.length ? (
          <>
            <p className="mt-2 text-xs text-muted">
              {b.processes.length} processes · {memory(b.memMb)} · {b.cpu.toFixed(1)}% CPU · open {duration(b.uptimeSeconds)}
            </p>
            <ul className="mt-1.5 grid grid-cols-1 gap-1 sm:grid-cols-2">
              {b.processes.map((p) => (
                <li key={p.pid} className="flex items-baseline justify-between gap-2 rounded-md bg-panel-2 px-2 py-1 text-xs">
                  <span className="truncate">{p.role}</span>
                  <span className="shrink-0 font-mono text-muted tabular-nums">{memory(p.memMb)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : null}
      </Section>

      <Section title="Apps and processes">
        {machine.apps.length === 0 ? (
          <p className="text-sm text-muted">Nothing of this bot is running.</p>
        ) : (
          <ul className="space-y-2">
            {machine.apps.map((a, i) => (
              <li key={`${a.kind}-${a.pids.join("-")}-${i}`} className="text-sm">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-medium text-ink">{a.name}</span>
                  <span className="shrink-0 text-xs text-muted">
                    {KIND_LABEL[a.kind]} · up {duration(a.uptimeSeconds)}
                  </span>
                </div>
                <p className="text-xs text-muted">{a.detail}</p>
                <Usage cpu={a.cpu} memMb={a.memMb} pids={a.pids} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Services it uses">
        <ul className="space-y-2.5">
          {machine.services.map((s) => {
            const badge = serviceBadge(s, machine.running);
            return (
              <li key={s.name} className="text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-ink">{s.name}</p>
                    <p className="group flex flex-wrap items-center gap-x-1 text-xs text-muted">
                      {s.role}
                      {s.address ? ` · ${s.address}` : ""}
                      {s.address ? <CopyButton text={s.address} what={`${s.name} address`} reveal /> : null}
                      {s.modelLoaded === true ? " · model in memory" : s.modelLoaded === false ? " · no model loaded" : ""}
                    </p>
                  </div>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </div>
                {s.running ? <Usage cpu={s.cpu} memMb={s.memMb} /> : null}
              </li>
            );
          })}
          {machine.remote ? (
            <li className="text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-ink">{machine.remote.name}</p>
                  <p className="text-xs break-words text-muted">
                    Main model{machine.remote.model ? ` · ${machine.remote.model}` : ""} · cloud service, no app on this Mac
                  </p>
                </div>
                {machine.running ? (
                  <Badge tone={machine.remote.connections > 0 ? "good" : "muted"}>
                    {machine.remote.connections > 0 ? `${machine.remote.connections} internet connection${machine.remote.connections === 1 ? "" : "s"}` : "no internet connections"}
                  </Badge>
                ) : null}
              </div>
            </li>
          ) : null}
          {machine.services.length === 0 && !machine.remote ? <li className="text-sm text-muted">No outside services.</li> : null}
        </ul>
      </Section>

      <Section title="Your apps">
        <dl className="space-y-1.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">In front now</dt>
            <dd className="text-ink">{machine.quiet.frontmostApp ?? "unknown"}</dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">Pause for games</dt>
            {/* "enabled" only means the bot watches for games; whether it is resting now is the status. */}
            <dd className="text-ink">
              {!machine.quiet.enabled
                ? "off"
                : machine.status === "quiet"
                  ? "paused now"
                  : machine.quiet.watched.some((w) => w.running)
                    ? "a game is running"
                    : "watching, not paused"}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="text-muted">Desktop control</dt>
            <dd className="text-ink">
              {machine.desktop.enabled ? `on${machine.desktop.dryRun ? ", dry run" : ""} · ${machine.desktop.allowedApps.join(", ")}` : "off"}
            </dd>
          </div>
        </dl>
        {machine.quiet.enabled && machine.quiet.watched.length ? (
          <div className="mt-2">
            <p className="mb-1.5 text-xs text-muted">The bot pauses only while one of these is running:</p>
            <div className="flex flex-wrap gap-1.5">
              {machine.quiet.watched.map((w) => (
                <Badge key={w.name} tone={w.running ? "warn" : "muted"}>
                  {w.name}
                  {w.running ? " · running" : ""}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
