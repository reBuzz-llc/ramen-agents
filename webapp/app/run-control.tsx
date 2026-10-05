"use client";

import { useEffect, useState } from "react";
import type { BotProfile } from "@/lib/bot";
import type { ControlOp, ControlResult } from "@/lib/control";
import type { BotMachine } from "@/lib/machine";
import { sendJson } from "@/lib/client";
import { buttonClass, Icon, Spinner } from "./ui";

/** Run / Stop for one bot, as a toolbar button. Stop leaves a STOP file, so launchd keeps it down until Run.
 * The result shows as a glass toast under the toolbar, so the bar itself never changes size. */
export default function RunControl({ bot, machine, onChange }: { bot: BotProfile; machine: BotMachine | null; onChange: () => void }) {
  const [pending, setPending] = useState<ControlOp | null>(null);
  const [message, setMessage] = useState<ControlResult | null>(null);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), message.ok ? 6000 : 12000);
    return () => clearTimeout(t);
  }, [message]);

  const known = machine !== null && !machine.error;
  const running = known && machine.running;

  async function act(op: ControlOp) {
    setPending(op);
    setMessage(null);
    const sent = await sendJson<ControlResult>(`/api/bots/${bot.slug}/control`, "POST", { op });
    setMessage(sent.body ?? { ok: sent.ok, note: sent.ok ? "Done." : (sent.error ?? "request failed") });
    setPending(null);
    onChange();
  }

  const how = machine?.launchAgent ? `Runs under launchd (${machine.launchAgent})` : "No launch agent: Run starts it in the background";

  return (
    <>
      {pending ? (
        <button type="button" disabled className={buttonClass("glass")}>
          <Spinner />
          <span className="hidden sm:inline">{pending === "run" ? "Starting…" : "Stopping…"}</span>
        </button>
      ) : running ? (
        <button type="button" onClick={() => window.confirm(`Stop ${bot.name}? It stays down until you press Run.`) && void act("stop")} title={how} aria-label={`Stop ${bot.name}`} className={`${buttonClass("glass")} !text-bad`}>
          <Icon name="stop" className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Stop</span>
        </button>
      ) : (
        <button type="button" onClick={() => act("run")} disabled={!known} title={how} aria-label={`Run ${bot.name}`} className={`${buttonClass("prominent")} glass-tinted`}>
          <Icon name="play" className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Run</span>
        </button>
      )}
      {message ? (
        <div className="pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+4.25rem)] z-40 flex justify-center px-4">
          <p
            role="status"
            className={`glass pointer-events-auto max-w-md rounded-full px-4 py-2 text-center text-sm font-medium [animation:toast-in_0.35s_var(--ease-spring)] ${message.ok ? "text-ink" : "text-bad"}`}
          >
            {message.note}
          </p>
        </div>
      ) : null}
    </>
  );
}
