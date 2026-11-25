import { agentName, nicknameOf } from "./agent-names";
import type { CardRequest, SampleCard } from "./samples";
// The sample statuses as the Samples page shows them: pure, so the page's client cards can import it.
export const CARD_STATUSES = ["draft", "changes_requested", "approved", "live", "taken_down", "rejected"] as const;
export const CARD_LABEL: Record<string, string> = {
  draft: "Draft ready", changes_requested: "Sent back", approved: "Approved", live: "Live", taken_down: "Taken down", rejected: "Rejected",
};
/** Each status's pill colours (the review screen's list and its sample). */
export const CARD_TONE: Record<string, string> = {
  draft: "bg-accent-tint text-accent-ink", changes_requested: "bg-bg text-ink", approved: "bg-bg text-ink", live: "bg-good/15 text-good", taken_down: "bg-bg text-muted",
  rejected: "bg-bad/10 text-bad",
};

// ---- what a decision does, and who has a request -- pure, for the page and its card
/** Whether the publisher is running: it asked within the last 30 minutes (it runs every 10). */
export const publisherRunning = (polledAt: string | null | undefined, now = Date.now()) => !!polledAt && now - new Date(polledAt).getTime() < 30 * 60_000;

/** What an Approve, a Take down or a Reject will do, read from the publish rules and the publisher's last visit (pure). */
/** How long ago the publisher last ran, in words ("4 min ago"). */
export const ranAgo = (polledAt: string | null | undefined, now = Date.now()) => {
  const m = polledAt ? Math.max(0, Math.round((now - new Date(polledAt).getTime()) / 60_000)) : NaN;
  return Number.isNaN(m) ? "" : m < 1 ? "just now" : `${m} min ago`;
};

export function decisionMessage(action: "approve" | "takedown" | "reject", c: Pick<SampleCard, "hold" | "url" | "guestPhotos" | "version"> & { website?: boolean },
  polledAt: string | null | undefined, now = Date.now()): string {
  const running = publisherRunning(polledAt, now);
  const paused = "Publishing to the web is paused on this Mac";
  if (action === "reject") return `Rejected: the ${agentName("Site Builder")} drops this lead and reads your reason. Nothing was on the web.`;
  if (action === "takedown") {
    if (!c.url) return "Taken down: it was not on the web.";
    return running ? `Taken down: it comes off the web on the publisher's next run (it last ran ${ranAgo(polledAt, now)}).` : `Taken down. ${paused}, so the page stays on the web until publishing runs again.`;
  }
  // the cases the publish rules keep off the web, said before any promise
  if (c.website) return "Approved, but the business has a website now: a sample is only for one without, so it is not published.";
  if (c.hold) return "Approved, but on hold: it stays off the web until someone releases it.";
  // a person's Approve publishes a page with a guest's photo too (only Settings' auto-approve waits for a person)
  const guests = c.guestPhotos.length ? ` It shows ${c.guestPhotos.length === 1 ? "a guest's photo" : "guests' photos"}: ask the business to swap ${c.guestPhotos.length === 1 ? "it" : "them"} if they mind.` : "";
  return running ? `Approved: it goes up on the publisher's next run (it last ran ${ranAgo(polledAt, now)}).${guests}` : `Approved. ${paused}, so nothing goes live yet.`;
}

/** What putting a taken-down sample back will really do, from the publish rules and the publisher's last visit. */
export function undoMessage(c: Pick<SampleCard, "hold">, polledAt: string | null | undefined, now = Date.now()): string {
  if (c.hold) return "Put back, but on hold: it stays off the web until someone releases it.";
  return publisherRunning(polledAt, now)
    ? `Put back: it becomes public again on the publisher's next run (it last ran ${ranAgo(polledAt, now)}).`
    : "Put back. Publishing to the web is paused on this Mac, so it is not public yet.";
}

/** The line for a version that leaves change requests open: it does not wait for a person's Approve. */
export const openRequestsLine = (version: number, open: number) => `Version ${version}, ${open} request${open === 1 ? "" : "s"} still open`;
/** Who may close or withdraw a request: the person who filed it, the owner or a manager. */
/** The builder's reason a version arrived incomplete, one line of at most 300 characters; "" when it is not one. */
export const NOT_COMPLETE_MAX = 300;
export const notCompleteReason = (v: unknown) => {
  const t = typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
  return t.length <= NOT_COMPLETE_MAX ? t : "";
};
export const notCompleteLine = (version: number, reason: string) => `Version ${version} is not complete: ${reason}`;
export const canCloseRequest = (who: { role: string; userId: string }, r: { byUser?: string | null }) =>
  who.role === "owner" || who.role === "manager" || (!!r.byUser && r.byUser === who.userId);

/** Who has an open change request now, from what Peek knows (pure): answered, with the site helper (a picture, or the last
 *  version is the helper's), or waiting for the Site Builder (it reads the open requests). */
/** Who made the site, as its card says it: the first drafter, and the latest one when someone else reworked it
 *  ("Site Builder, reworked by site helper"). Names pass through `name` (the agents' nicknames). */
export function authorLine(first: string, latest: string, name: (n: string) => string = (n) => n): string {
  const a = (first || latest).trim();
  const b = latest.trim();
  if (!a) return "";
  return b && b.toLowerCase() !== a.toLowerCase() ? `${name(a)}, reworked by ${name(b)}` : name(a);
}

export function requestState(r: Pick<CardRequest, "status" | "answeredVersion" | "pictures" | "at">, draftedBy: string): string {
  if (r.status === "answered") return `answered by version ${r.answeredVersion}`;
  // the Site Builder's own claim, until a person's Approve or Done confirms it
  if (r.status === "addressed") return `Claimed done in version ${r.answeredVersion}, to check`;
  if (r.status !== "open") return r.status;
  if (r.pictures.length) return `with the ${agentName("site helper")}, it has a picture`;
  if (/site ?helper/i.test(draftedBy) || (!!nicknameOf("site helper") && draftedBy.toLowerCase().includes(nicknameOf("site helper").toLowerCase()))) return `with the ${agentName("site helper")}`;
  return `waiting for the ${agentName("Site Builder")}`;
}

/** The sample's rows act as one group, at most one open. A sample never seen in this browser
 *  opens with "Why this design"; what is remembered keeps one row (the last opened, from an older many-row memory) or none. */
export const FOLD_DEFAULT = "why";
export function foldsFrom(stored: string | null): string[] {
  if (stored === null) return [FOLD_DEFAULT];
  try {
    const v = JSON.parse(stored) as unknown;
    const rows = Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    return rows.slice(-1);
  } catch {
    return [FOLD_DEFAULT];
  }
}
/** Opening a row closes whichever was open; closing the open row leaves all closed. */
export const foldToggle = (cur: string[], k: string): string[] => (cur.includes(k) ? [] : [k]);

/** The gallery target as a plain line -- a target, never counted as a check, never a
 *  warning, never a block. Null when the sample has no gallery to count (a template sample). */
export const GALLERY_TARGET = 20;
export const galleryLine = (n: number | null | undefined): string | null =>
  n === null || n === undefined ? null : `Gallery: aim for more than ${GALLERY_TARGET} photos (${n} so far)`;

/** The owner's storage line on Samples (pure). Megabytes with one decimal under 10, whole above. */
export function storageLine(u: { totalBytes: number; sampleBytes: number; samples: number }, free = 1024 * 1024 * 1024): string {
  const mb = (b: number) => { const m = b / 1024 / 1024; return m < 10 ? m.toFixed(1) : String(Math.round(m)); };
  const pct = Math.round((u.totalBytes / free) * 100);
  return `${storageFull(u, free) ? "Nearly full: " : ""}Photo storage: ${mb(u.totalBytes)} MB of ${Math.round(free / 1024 / 1024 / 1024)} GB used (${pct}%) · sample photos ${mb(u.sampleBytes)} MB in ${u.samples} sample${u.samples === 1 ? "" : "s"}, the rest is the team's Files`;
}

/** The storage line warns at 80% of the free plan. */
export const storageFull = (u: { totalBytes: number }, free = 1024 * 1024 * 1024) => u.totalBytes >= 0.8 * free;
