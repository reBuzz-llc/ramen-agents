// The office's sounds (creatorCC queue 27; owner, 10-31: "there is a constant background noise", "like wind blowing";
// queue 59: "almost none"): no loop, no drone, no hum. Short, soft one-shots, each under 0.6 s: a click when a message
// takes off, a chime for a published package or a new CEO proposal, a page-flip when a draft goes to the post box, a
// pencil tick for a note, a pop for a pinned lead, a low muted thud for a refusal (at most once a minute), a soft rise
// when a member wakes from a rest, a tiny buzz when a bee lands, and one quiet ambient one-shot every 90-120 s (a bird
// call or a water lap, never the same twice in a row; lib/sound-plan.ts has the rules). They never stack (one at a
// time, at least 0.7 s apart; a sound asked for meanwhile is dropped), and the AudioContext is suspended between them,
// so nothing runs while no event fires. Off by default; the toggle is remembered per browser and starts audio itself,
// and after a reload with sound on the first click or key anywhere starts it (a browser allows audio only after one).
import type { Cue } from "@/lib/sound-plan";

const KEY = "world-sound";
const GAP_MS = 700;
let ctx: AudioContext | null = null;
let busyUntil = 0;
let idle: ReturnType<typeof setTimeout> | null = null;

export function soundWanted(): boolean {
  try {
    return localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function rememberSound(on: boolean) {
  try {
    localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    /* not remembered */
  }
}

/** Called from the toggle's click: creates the AudioContext inside the gesture, then suspends it again. */
export function unlockSound() {
  if (typeof window === "undefined" || !("AudioContext" in window)) return;
  ctx ??= new AudioContext();
  void ctx.resume().then(() => sleep(0.1));
}

/** Suspend the context `after` seconds from now, unless another sound comes first. */
function sleep(after: number) {
  if (idle) clearTimeout(idle);
  idle = setTimeout(() => void ctx?.suspend(), after * 1000);
}

/** Run one sound of `len` seconds if none is playing; false when it was dropped (or there is no audio). */
function play(len: number, build: (a: AudioContext, at: number) => void): boolean {
  if (!ctx) return false;
  const now = performance.now();
  if (now < busyUntil) return false;
  busyUntil = now + Math.max(GAP_MS, len * 1000 + 200);
  const a = ctx;
  void a.resume().then(() => {
    build(a, a.currentTime + 0.01);
    sleep(len + 0.15);
  });
  return true;
}

/** A soft click: a message takes off. */
export function click() {
  return play(0.08, (a, t) => {
    const o = a.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(1800, t);
    o.frequency.exponentialRampToValueAtTime(900, t + 0.05);
    const g = a.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    o.connect(g).connect(a.destination);
    o.start(t);
    o.stop(t + 0.08);
  });
}

/** Two soft notes: a published package, or a new CEO proposal on the bulletin board. */
export function chime() {
  return play(0.45, (a, t) => {
    [880, 1318.5].forEach((f, i) => {
      const o = a.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      const g = a.createGain();
      const s = t + i * 0.1;
      g.gain.setValueAtTime(0.0001, s);
      g.gain.exponentialRampToValueAtTime(0.05, s + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, s + 0.32);
      o.connect(g).connect(a.destination);
      o.start(s);
      o.stop(s + 0.35);
    });
  });
}

/** A page turning: a short band of noise, swept: a draft written. */
export function pageFlip() {
  return play(0.25, (a, t) => {
    const len = Math.floor(a.sampleRate * 0.22);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const bp = a.createBiquadFilter();
    bp.type = "bandpass";
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(1200, t);
    bp.frequency.exponentialRampToValueAtTime(3800, t + 0.2);
    const g = a.createGain();
    g.gain.value = 0.06;
    src.connect(bp).connect(g).connect(a.destination);
    src.start(t);
  });
}

/** One soft tone gliding from `f0` to `f1` Hz over `len` s, at `vol`: the building block of the small sounds. */
function tone(a: AudioContext, t: number, f0: number, f1: number, len: number, vol: number, type: OscillatorType = "sine") {
  const o = a.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + len);
  const g = a.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, len / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  o.connect(g).connect(a.destination);
  o.start(t);
  o.stop(t + len + 0.02);
}

/** A short burst of filtered noise: the pencil and the water. */
function noise(a: AudioContext, t: number, len: number, type: BiquadFilterType, f0: number, f1: number, vol: number) {
  const n = Math.floor(a.sampleRate * len);
  const buf = a.createBuffer(1, n, a.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / n);
  const src = a.createBufferSource();
  src.buffer = buf;
  const f = a.createBiquadFilter();
  f.type = type;
  f.Q.value = 1.5;
  f.frequency.setValueAtTime(f0, t);
  f.frequency.exponentialRampToValueAtTime(f1, t + len);
  const g = a.createGain();
  g.gain.value = vol;
  src.connect(f).connect(g).connect(a.destination);
  src.start(t);
}

/** A pencil tick: a note. */
export const tick = () => play(0.06, (a, t) => noise(a, t, 0.04, "highpass", 3500, 5000, 0.05));
/** A pop: a pinned lead. */
export const pop = () => play(0.12, (a, t) => tone(a, t, 520, 980, 0.1, 0.05));
/** A low muted thud: a refusal (the plan lets one through a minute). */
export const thud = () => play(0.2, (a, t) => tone(a, t, 140, 70, 0.18, 0.06));
/** A soft rise: a member wakes from a rest. */
export const rise = () => play(0.5, (a, t) => tone(a, t, 330, 660, 0.45, 0.035));
/** A tiny buzz: a bee lands. */
export const buzz = () => play(0.25, (a, t) => tone(a, t, 180, 210, 0.22, 0.02, "sawtooth"));
/** A bird call: two quick chirps, far away. */
export const bird = () =>
  play(0.4, (a, t) => {
    tone(a, t, 2600, 3400, 0.09, 0.02);
    tone(a, t + 0.14, 2800, 3600, 0.11, 0.018);
  });
/** A water lap against the pier. */
export const lap = () => play(0.55, (a, t) => noise(a, t, 0.5, "lowpass", 600, 250, 0.05));

/** Play a cue by name. */
export function playCue(c: Cue): boolean {
  return { click, chime, flip: pageFlip, tick, pop, thud, rise, buzz, bird, lap }[c]();
}

/** For the check that nothing plays between events: the context's state ("suspended" when idle). */
export const soundState = () => ctx?.state ?? "none";
