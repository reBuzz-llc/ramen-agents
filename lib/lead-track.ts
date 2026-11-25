// The lead panel's status: one labelled progress line per channel, showing where the lead stands and what
// can come next. It adds no rule of its own: what can be pressed, and what a press writes, are lib/lead-workflow.ts's steps. A
// Meeting or a Won counts the steps before it as reached, as the scoreboard does. Pure, tested.
import { emailSteps, whatsappSteps, type Step } from "./lead-workflow";

export type NodeState = "done" | "current" | "next" | "later" | "stopped";
export type TrackNode = { key: string; label: string; state: NodeState; step?: Step };
export type TrackClear = { field: "email_status" | "result" | "whatsapp_status"; label: string; what: string };
export type Track = { channel: "email" | "whatsapp"; label: string; nodes: TrackNode[]; more: Step[]; clears: TrackClear[]; note: string | null };

const READY = "Ready to Send Email";
const SENT = "Email Sent";
const LEVEL: Record<string, number> = { Replied: 1, Meeting: 2, Client: 3 };
const STOPPED: Record<string, string> = { "Not interested": "Lost", Bounced: "Bounced" };
const WA_ASKED = "Waiting response for WhatsApp verification";
const WA_VERIFIED = "WhatsApp Verified";
const WA_SENT = "WhatsApp msg sent";
const WA_FALSE = "False Whatsapp Number";
const WA_LEVEL: Record<string, number> = { [WA_ASKED]: 1, [WA_VERIFIED]: 2, [WA_SENT]: 3 };

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** The path's nodes from what was reached and what can be pressed now; the last one reached is the current one. */
function nodesOf(path: { key: string; label: string; reached: boolean }[], steps: Step[]): TrackNode[] {
  let last = -1;
  path.forEach((p, i) => {
    if (p.reached) last = i;
  });
  return path.map((p, i) => {
    const step = steps.find((s) => s.key === p.key);
    if (p.reached) return { key: p.key, label: p.label, state: i === last ? "current" : "done" };
    return step ? { key: p.key, label: p.label, state: "next", step } : { key: p.key, label: p.label, state: "later" };
  });
}

function emailTrack(l: Record<string, unknown>, now: Date): Track {
  const status = text(l.email_status);
  const result = text(l.result);
  const steps = emailSteps(l, now);
  const level = LEVEL[result] ?? 0;
  const first = [
    { key: "email:ready", label: "Ready", reached: status === READY || status === SENT },
    { key: "email:sent", label: "Sent", reached: status === SENT },
  ];
  const rest = [
    { key: "result:Replied", label: "Replied", reached: level >= 1 },
    { key: "result:Meeting", label: "Meeting", reached: level >= 2 },
    { key: "result:Client", label: "Won", reached: level >= 3 },
  ];
  const stop = STOPPED[result];
  const nodes = stop ? [...nodesOf(first, steps), { key: `stop:${result}`, label: stop, state: "stopped" as const }] : nodesOf([...first, ...rest], steps);
  const onPath = new Set(nodes.map((n) => n.key));
  const clears: TrackClear[] = [];
  if (result) clears.push({ field: "result", label: "Clear result", what: "Result" });
  if (status) clears.push({ field: "email_status", label: "Clear email status", what: "Email status" });
  // a value the line cannot place is still shown, so nothing on the lead is hidden
  const odd = [status && status !== READY && status !== SENT ? status : "", result && result !== "Not contacted" && !LEVEL[result] && !stop && !(result === "Emailed" && status === SENT) ? result : ""].filter(Boolean);
  return { channel: "email", label: "Email", nodes, more: steps.filter((s) => !onPath.has(s.key)), clears, note: odd.length ? odd.join(" · ") : null };
}

function whatsappTrack(l: Record<string, unknown>): Track | null {
  const status = text(l.whatsapp_status);
  if (!l.whatsapp && !status) return null;
  const steps = whatsappSteps(l);
  const level = WA_LEVEL[status] ?? 0;
  const asked = { key: `wa:${WA_ASKED}`, label: "Asked", reached: level >= 1 };
  const nodes =
    status === WA_FALSE
      ? [...nodesOf([{ ...asked, reached: true }], steps), { key: `stop:${WA_FALSE}`, label: "False number", state: "stopped" as const }]
      : nodesOf([asked, { key: `wa:${WA_VERIFIED}`, label: "Verified", reached: level >= 2 }, { key: `wa:${WA_SENT}`, label: "Message sent", reached: level >= 3 }], steps);
  const onPath = new Set(nodes.map((n) => n.key));
  return {
    channel: "whatsapp",
    label: "WhatsApp",
    nodes,
    more: steps.filter((s) => !onPath.has(s.key)),
    clears: status ? [{ field: "whatsapp_status", label: "Clear WhatsApp status", what: "WhatsApp status" }] : [],
    note: status && !level && status !== WA_FALSE ? status : null,
  };
}

export function leadTracks(l: Record<string, unknown>, now = new Date()): Track[] {
  const wa = whatsappTrack(l);
  return wa ? [emailTrack(l, now), wa] : [emailTrack(l, now)];
}
