// Which of the world's sounds plays when (creatorCC queue 59; owner: "almost none"). The pure rules, for the tests: an
// event's cue, the caps (a refusal's thud at most once a minute), the ambient one-shot every 90-120 s (a bird call or a
// water lap, never the same twice in a row), and arming the audio on the first click or key after a reload. The sounds
// themselves are in app/world-sound.ts, which keeps the 0.7 s gap and suspends the context between them.

// No imports, so the tests run it as it is: the same small seeded generator as lib/world.ts's (mulberry32).
function seeded(seed: number, n: number): number {
  let a = (seed + Math.imul(n + 1, 0x9e3779b9)) >>> 0;
  a = (a + 0x6d2b79f5) >>> 0;
  let t = Math.imul(a ^ (a >>> 15), a | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export type Cue = "click" | "chime" | "flip" | "tick" | "pop" | "thud" | "rise" | "buzz" | "bird" | "lap";
export const THUD_EVERY_MS = 60_000;
export const AMBIENT_MIN_MS = 90_000;
export const AMBIENT_MAX_MS = 120_000;

export type SoundPlan = { seed: number; n: number; thudAt: number; ambientAt: number; lastAmbient: "bird" | "lap" | null };
const gap = (seed: number, n: number) => AMBIENT_MIN_MS + Math.floor(seeded(seed, n) * (AMBIENT_MAX_MS - AMBIENT_MIN_MS + 1));
export const newSoundPlan = (seed: number, now: number): SoundPlan => ({ seed, n: 1, thudAt: -Infinity, ambientAt: now + gap(seed, 0), lastAmbient: null });

/** An action's cue: a pencil tick for a note, a pop for a pinned lead, a thud for a refusal; null for the rest. */
export function actCue(act: { type: string; verdict: string }): Cue | null {
  if (act.verdict === "refused") return "thud";
  if (act.verdict !== "allowed") return null;
  if (act.type === "note") return "tick";
  if (act.type === "lead" || act.type === "update_lead") return "pop";
  return null;
}

// One sound a poll: the rarest and most telling first.
const ORDER: Cue[] = ["chime", "flip", "pop", "rise", "tick", "click", "buzz", "thud"];

/** The one cue to play from those this poll asked for, or null; a thud only once a minute (the plan is updated). */
export function pickCue(plan: SoundPlan, now: number, wanted: Cue[]): Cue | null {
  for (const c of ORDER) {
    if (!wanted.includes(c)) continue;
    if (c === "thud") {
      if (now - plan.thudAt < THUD_EVERY_MS) continue;
      plan.thudAt = now;
    }
    return c;
  }
  return null;
}

/** The ambient one-shot when it is due, else null: a bird call or a water lap, never the same twice in a row, the next
 *  one 90-120 s later (seeded). */
export function ambientDue(plan: SoundPlan, now: number): "bird" | "lap" | null {
  if (now < plan.ambientAt) return null;
  const kind = plan.lastAmbient === null ? (seeded(plan.seed, plan.n++) < 0.5 ? "bird" : "lap") : plan.lastAmbient === "bird" ? "lap" : "bird";
  plan.lastAmbient = kind;
  plan.ambientAt = now + gap(plan.seed, plan.n++);
  return kind;
}

/** A member waking: its state word was "resting..." and is not any more. */
export const woke = (before: string | undefined, after: string) => !!before && /^resting/i.test(before) && !/^resting/i.test(after);

/** After a reload with sound on, the browser allows audio only after a gesture: unlock on the first click or key
 *  anywhere, once. Returns the clean-up. */
export function armUnlock(target: EventTarget, wanted: boolean, unlock: () => void): () => void {
  if (!wanted) return () => {};
  const once = () => {
    off();
    unlock();
  };
  const off = () => {
    target.removeEventListener("pointerdown", once);
    target.removeEventListener("keydown", once);
  };
  target.addEventListener("pointerdown", once);
  target.addEventListener("keydown", once);
  return off;
}
