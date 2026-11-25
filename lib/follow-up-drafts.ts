// The Follow up tab and the Writer's side of it (the shape agreed with the Validator). Up to three
// follow-ups, 2, 5 and 14 days after the send. Each step has its own draft in leads.followup_drafts:
//   {"1": {"text": "...", "channel": "email"|"whatsapp", "by": "bot"|"person", "at": "..."}, "2": {"skip": "...", "by": ..., "at": ...}}
// `by` and `at` are stamped here on the server, never read from a request. A bot may not overwrite a step a person wrote. Pure: the
// browser imports it too.
export const FOLLOW_UP_DAYS = [2, 5, 14] as const;
export const MAX_FOLLOW_UPS = FOLLOW_UP_DAYS.length;
/** Never two follow-ups to one business within this many days, when a person marks a step late. */
export const MIN_GAP_DAYS = 2;
const TEXT_MAX = 4000;
const SKIP_MAX = 300;
const DAY = 86_400_000;

export type StepKey = "1" | "2" | "3";
export type FollowUpChannel = "email" | "whatsapp";
export type DraftStep = { text: string; channel: FollowUpChannel; by: "bot" | "person"; at: string } | { skip: string; by: "bot" | "person"; at: string };
export type FollowUpDrafts = Partial<Record<StepKey, DraftStep>>;
export type StepInput = { text: string; channel: FollowUpChannel } | { skip: string };

const KEYS: StepKey[] = ["1", "2", "3"];

/** A write's steps, checked: what is asked for, or the reason it is refused. `by` and `at` in a request are ignored. */
export function readStepInput(v: unknown): { ok: true; steps: Map<StepKey, StepInput> } | { ok: false; message: string } {
  const bad = (message: string) => ({ ok: false as const, message });
  if (!v || typeof v !== "object" || Array.isArray(v)) return bad('followup_drafts is one object by step: {"1": {"text": "...", "channel": "email"}}');
  const steps = new Map<StepKey, StepInput>();
  for (const [k, raw] of Object.entries(v)) {
    if (!KEYS.includes(k as StepKey)) return bad(`followup_drafts has steps 1, 2 and 3; not "${k.slice(0, 20)}"`);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad(`followup_drafts step ${k} is an object`);
    const { text, skip, channel } = raw as { text?: unknown; skip?: unknown; channel?: unknown };
    if (text !== undefined && skip !== undefined) return bad(`followup_drafts step ${k} has both text and skip: send one`);
    if (skip !== undefined) {
      if (typeof skip !== "string" || !skip.trim() || skip.trim().length > SKIP_MAX) return bad(`followup_drafts step ${k}: skip is a reason of 1 to ${SKIP_MAX} characters`);
      steps.set(k as StepKey, { skip: skip.trim() });
      continue;
    }
    if (typeof text !== "string" || !text.trim() || text.trim().length > TEXT_MAX) return bad(`followup_drafts step ${k}: text is 1 to ${TEXT_MAX} characters`);
    // a skip written as text could be copied into a send box and reach a client
    if (/^\s*skip\s*:/i.test(text)) return bad(`followup_drafts step ${k}: a skip goes in "skip", never in "text"`);
    if (channel !== "email" && channel !== "whatsapp") return bad(`followup_drafts step ${k}: channel is email or whatsapp`);
    steps.set(k as StepKey, { text: text.trim(), channel });
  }
  if (!steps.size) return bad("followup_drafts names no step");
  return { ok: true, steps };
}

/** The steps asked for laid over the stored ones. A bot's write to a step a person wrote is refused; the others still apply. */
export function mergeDrafts(current: FollowUpDrafts | null | undefined, steps: Map<StepKey, StepInput>, by: "bot" | "person", now: Date) {
  const next: FollowUpDrafts = { ...(current ?? {}) };
  const written: StepKey[] = [];
  const refused: StepKey[] = [];
  for (const [k, step] of steps) {
    const old = next[k];
    if (by === "bot" && old?.by === "person") {
      refused.push(k);
      continue;
    }
    if (old && "text" in old && "text" in step && old.text === step.text && old.channel === step.channel && old.by === by) continue;
    if (old && "skip" in old && "skip" in step && old.skip === step.skip && old.by === by) continue;
    next[k] = { ...step, by, at: now.toISOString() };
    written.push(k);
  }
  return { next, written, refused };
}

/** The next follow-up of a lead and when it is due, or null after the third. */
export function nextStep(sentAt: Date, done: { step: number; sentAt: Date }[]): { step: 1 | 2 | 3; dueAt: Date } | null {
  const last = done.reduce((n, d) => Math.max(n, d.step), 0);
  if (last >= MAX_FOLLOW_UPS) return null;
  const step = (last + 1) as 1 | 2 | 3;
  const planned = sentAt.getTime() + FOLLOW_UP_DAYS[step - 1] * DAY;
  const latest = done.reduce((t, d) => Math.max(t, d.sentAt.getTime()), 0);
  return { step, dueAt: new Date(latest ? Math.max(planned, latest + MIN_GAP_DAYS * DAY) : planned) };
}

// The engine's ramen.site_day.SAYS_BUILT: a message never says a website was created when none exists. An offer to
// build one is not a claim.
const SAYS_BUILT = /\bwe(?:'ve|’ve| have)?(?: already| just)?(?: gone ahead and| went ahead and)?(?: already)? (?:created|built|made|designed)\b[^.!?\n]{0,30}\b(?:website|site)\b|\bwhat we(?:'ve|’ve| have) (?:created|built|made)\b/i;
const SAMPLE_LINK = /https?:\/\/[a-z0-9-]+\.pages\.dev(?:\/[^\s"'<>)]*)?/gi;
const bare = (u: string) => u.replace(/[.,;:!?]+$/, "").replace(/\/+$/, "").toLowerCase();

export const SAYS_BUILT_LINE = "Held: this follow-up says a website was created and no sample is approved. Edit the sentence.";
export const NO_SAMPLE_LINE = "Held: this follow-up links to a sample that is not live. Edit the link.";

/** Why a follow-up's text may not be copied, or "": it says something we have not done, or links to a sample that is not up. */
export function draftHold(text: string, sample: { approved: boolean; liveUrl: string }): string {
  if (SAYS_BUILT.test(text) && !sample.approved) return SAYS_BUILT_LINE;
  const live = sample.liveUrl ? bare(sample.liveUrl) : "";
  for (const m of text.matchAll(SAMPLE_LINK)) if (bare(m[0]) !== live) return NO_SAMPLE_LINE;
  return "";
}
