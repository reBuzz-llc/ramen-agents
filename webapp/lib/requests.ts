// Server-side only: bot-to-bot requests, on record (common-data/shared-state/requests.jsonl, written by
// src/explorer/fleet_requests.py — owner, 2026-09-24: "a CEO request to any bot is the top priority and must
// be visible somewhere in the webapp"). Every direct `message` between bots is a "request" event; "read" /
// "answered" / "resolved" events fold onto it by id. Read-only here — the bots write, this shows it.
import { readFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR } from "./bots";

export type FleetRequest = {
  id: string;
  from: string;
  to: string;
  text: string;
  sentAt: string;
  priority: boolean;
  readAt: string | null;
  answeredAt: string | null;
  answer: string | null;
  resolvedAt: string | null;
  resolvedNote: string | null;
  /** An ask nobody answered or resolved within EXPIRE_HOURS: the bots stop treating it as open. */
  expired: boolean;
};

/** Mirrors EXPIRE_HOURS in src/explorer/fleet_requests.py, so the badge here and the bots agree. */
export const EXPIRE_HOURS = 48;

type Event = {
  kind?: string;
  id?: string;
  from?: string;
  to?: string;
  text?: string;
  priority?: boolean;
  answer?: string;
  note?: string;
  at?: string;
};

const REQUESTS_FILE = path.join(BOTS_DIR, "common-data", "shared-state", "requests.jsonl");

/** Every request, folded by id, newest sent first. One JSON object per line; a torn last line is skipped. */
export async function readRequests(limit = 500): Promise<FleetRequest[]> {
  let text: string;
  try {
    text = await readFile(/*turbopackIgnore: true*/ REQUESTS_FILE, "utf8");
  } catch {
    return []; // no requests logged yet
  }
  const byId = new Map<string, FleetRequest>();
  const order: string[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    let d: Event;
    try {
      d = JSON.parse(line) as Event;
    } catch {
      continue; // a line torn by a concurrent append; skip it
    }
    const id = String(d.id ?? "");
    if (!id) continue;
    if (d.kind === "request") {
      if (!byId.has(id)) order.push(id);
      byId.set(id, {
        id,
        from: String(d.from ?? ""),
        to: String(d.to ?? ""),
        text: String(d.text ?? ""),
        sentAt: String(d.at ?? ""),
        priority: d.priority === true,
        readAt: null,
        answeredAt: null,
        answer: null,
        resolvedAt: null,
        resolvedNote: null,
        expired: false,
      });
      continue;
    }
    const existing = byId.get(id);
    if (!existing) continue; // an answered/resolved/read event for a request line we don't have (or a torn one)
    if (d.kind === "read") existing.readAt ??= String(d.at ?? "");
    else if (d.kind === "answered") {
      existing.answeredAt ??= String(d.at ?? "");
      existing.answer ??= d.answer != null ? String(d.answer) : null;
    } else if (d.kind === "resolved") {
      existing.resolvedAt ??= String(d.at ?? "");
      existing.resolvedNote ??= d.note != null ? String(d.note) : null;
    }
  }
  const all = order.map((id) => byId.get(id)!).reverse(); // newest sent first
  const cutoff = Date.now() - EXPIRE_HOURS * 3_600_000;
  for (const r of all) {
    const sent = Date.parse(r.sentAt);
    r.expired = !r.answeredAt && !r.resolvedAt && Number.isFinite(sent) && sent < cutoff;
  }
  return all.slice(0, limit);
}
