// The office's sounds (owner, 10-31: "there is a constant background noise", "like wind blowing"):
// no loop, no drone, no hum. Only three short, soft event sounds, each under half a second: a click for a new
// output, a chime for a new CEO proposal, a page-flip when a draft is written. They never stack (one at a time, at
// least 0.7 s apart; a sound asked for meanwhile is dropped), and the AudioContext is suspended between them, so nothing
// runs while no event fires. Off by default; the toggle is remembered per browser and starts audio itself (a browser
// allows audio only after a click).

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

/** A soft click: a new accepted output. */
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

/** Two soft notes: a new CEO proposal on the bulletin board. */
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

/** For the check that nothing plays between events: the context's state ("suspended" when idle). */
export const soundState = () => ctx?.state ?? "none";
