// The home page's office world (2026-10-30, owner: "a 2D world, the agents as pixel characters,
// with a window that shows what each one is working on"). The pure parts, kept apart from the canvas so the tests run
// with Node's own runner: what each state looks like, where everything stands in the room, the paths between, the
// dialogue box's lines, the speech bubbles a poll brings, and each member's look (the same everywhere it is drawn).
// All data comes from /api/board (lib/board-read.ts); nothing here reads a file.
import type { BotCard, Screen } from "./board";

export const TILE = 16;
export const COLS = 24; // five desks a row (10-31: with the owner's three starts, 9 bots ran and the CEO had no desk)
export const ROWS = 13;

/** What a character does for a state word. */
type Anim = "working" | "idle" | "resting" | "quiet" | "blocked" | "lost";

export function animOf(state: { word: string }): Anim {
  const w = state.word;
  if (w === "working") return "working";
  if (w.startsWith("resting")) return "resting";
  if (w === "quiet") return "quiet";
  if (w === "stalled" || w.startsWith("no heartbeat")) return "lost";
  if (w === "restarting") return "idle"; // stays at its desk while restart-bot.sh runs
  if (w.startsWith("blocked")) return "blocked";
  return "idle"; // paused, waiting for a task
}

/** A thundercloud over the head: the model provider is failing for this member. */
export const stormOf = (state: { word: string }) => /model provider/.test(state.word);

/** "resting until 14:40" -> "14:40", for the little clock over the sofa. */
export const restUntil = (state: { word: string }) => /until (\d{2}:\d{2})/.exec(state.word)?.[1] ?? "";

export type Pt = { x: number; y: number }; // tiles
export const MAX_DESKS = 10; // a desk for every family member
const DESK_COLS = [2, 6, 10, 14, 18];
const DESK_ROWS = [4, 8]; // desks; the member sits on the row above, facing the room

export const DESK_W = 44; // px: a wide desk, the monitor on the left facing the room, the member on the right
export const MONITOR = { x: 2, y: -22, w: 26, h: 16 }; // px from the desk's top-left corner
export const NAMEPLATE = { x: 15, y: 5, w: 14, h: 6 };

/** Desk i (0..9): its top-left tile, and the seat (where the member sits, behind it, beside the monitor). */
export function desk(i: number): { desk: Pt; seat: Pt } {
  const x = DESK_COLS[i % DESK_COLS.length];
  const y = DESK_ROWS[Math.floor(i / DESK_COLS.length) % 2];
  return { desk: { x, y }, seat: { x: x + 1.75, y: y - 1 } };
}

// The web terminal stands against the right wall at the middle aisle, beside the corridor every walk already uses
// (queue 27: on the left wall each visit crossed the whole room along that aisle and back). A member stands one tile
// left of it, reached from either desk row by its aisle and the corridor, never across a desk.
export const TERMINAL: Pt = { x: 21, y: 5 };
export const sofaSeat = (i: number): Pt => ({ x: 1 + (i % 5), y: 11 });
/** Mat i in the sleeping corner, which grows with the stopped count: four along the bottom right, then two more to their
 *  left (as far as the sofa allows), then a second row above. */
export function bedSpot(i: number): Pt {
  if (i < 4) return { x: 16 + i * 2, y: 11.5 };
  if (i < 7) return { x: 14 - (i - 4) * 2, y: 11.5 };
  return { x: 10 + ((i - 7) % 7) * 2, y: 10.25 - Math.floor((i - 7) / 7) * 1.5 };
}
export const BULLETIN = { x: 10, y: 0, w: 4, h: 2 };
export const MAILBOX = { x: 20, y: 0, w: 1, h: 2 }; // on the back wall, left of the door, where the mail arrives
export const DOOR = { x: 21, y: 0, w: 2, h: 2 };

// Walks are shortest paths on a quarter-tile grid (owner, 10-31: "characters are not taking the shortest path").
// Blocked: the walls, every desk with its chair, the terminal cabinet, the sofa, the mats, the plants. A walker may
// enter its own seat, sofa place or mat only straight down its column from above, never across the furniture. Among the
// shortest paths the one with the fewest turns wins, so walks keep to the aisles.
const STEP = 0.25;
const GX = COLS * 4; // x: 0 .. 23.75
const GY0 = 2; // y: 2 .. 12.75, below the wall
const GY = 44;
type Box = { x0: number; y0: number; x1: number; y1: number; spots: Pt[] };
const PLANTS: Box[] = [
  { x0: -0.1, y0: 4.9, x1: 1.0, y1: 6.2, spots: [] },
  { x0: -0.1, y0: 9.9, x1: 1.0, y1: 11.2, spots: [] },
  { x0: 22.9, y0: 7.4, x1: 24, y1: 8.6, spots: [] },
];

function boxes(beds: Pt[]): Box[] {
  const out: Box[] = [];
  for (let i = 0; i < MAX_DESKS; i++) {
    const { desk: d, seat } = desk(i);
    out.push({ x0: d.x - 0.2, y0: d.y - 1.5, x1: d.x + 3.0, y1: d.y + 1.0, spots: [seat] }); // the desk and its chair
  }
  out.push({ x0: 21.9, y0: 4.0, x1: 24, y1: 6.2, spots: [] }); // the terminal cabinet
  out.push({ x0: 0.7, y0: 10.4, x1: 6.3, y1: 11.7, spots: Array.from({ length: 5 }, (_, i) => sofaSeat(i)) }); // one sofa, five places
  for (const b of beds) out.push({ x0: b.x - 0.85, y0: b.y - 0.35, x1: b.x + 0.85, y1: b.y + 0.45, spots: [b] });
  return [...out, ...PLANTS];
}

const key = (i: number, j: number) => j * GX + i;
const cellOf = (p: Pt) => ({ i: Math.round(p.x / STEP), j: Math.round((p.y - GY0) / STEP) });
const ptOf = (i: number, j: number): Pt => ({ x: i * STEP, y: GY0 + j * STEP });

/** Which cells a walk from `from` to `to` may use: free floor, plus its own start and end spots' columns. */
function walkable(from: Pt, to: Pt, beds: Pt[]): (i: number, j: number) => boolean {
  const bs = boxes(beds);
  const own = (p: Pt, b: Box) => b.spots.some((q) => Math.abs(q.x - p.x) < 1e-6 && Math.abs(q.y - p.y) < 1e-6);
  return (i, j) => {
    if (i < 0 || j < 0 || i >= GX || j >= GY) return false;
    const p = ptOf(i, j);
    for (const b of bs) {
      if (p.x > b.x0 && p.x < b.x1 && p.y > b.y0 && p.y < b.y1) {
        // its own spot is reached from above only (the chair side of a desk, the front of the sofa, a mat's head)
        const mine = (own(from, b) && Math.abs(p.x - from.x) < 1e-6 && p.y <= from.y + 1e-6) || (own(to, b) && Math.abs(p.x - to.x) < 1e-6 && p.y <= to.y + 1e-6);
        if (!mine) return false;
      }
    }
    return true;
  };
}

const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** The length (in tiles) of the shortest walk, by a plain breadth-first search: the harness's independent check. */
export function gridDistance(from: Pt, to: Pt, beds: Pt[] = []): number {
  const ok = walkable(from, to, beds);
  const s = cellOf(from);
  const g = cellOf(to);
  const dist = new Map<number, number>([[key(s.i, s.j), 0]]);
  const q = [s];
  while (q.length) {
    const c = q.shift()!;
    const d = dist.get(key(c.i, c.j))!;
    if (c.i === g.i && c.j === g.j) return d * STEP;
    for (const [di, dj] of DIRS) {
      const n = { i: c.i + di, j: c.j + dj };
      if (!ok(n.i, n.j) || dist.has(key(n.i, n.j))) continue;
      dist.set(key(n.i, n.j), d + 1);
      q.push(n);
    }
  }
  return Infinity;
}

/** The shortest walk between two spots (fewest turns among equals), as the corners it turns at, ending on `to`. */
export function route(from: Pt, to: Pt, beds: Pt[] = []): Pt[] {
  if (Math.abs(from.x - to.x) < 1e-6 && Math.abs(from.y - to.y) < 1e-6) return [];
  const ok = walkable(from, to, beds);
  const s = cellOf(from);
  const g = cellOf(to);
  // Dijkstra over (cell, heading): a step costs 1000, a turn 1, so length comes first and turns break ties
  const best = new Map<number, number>();
  const prev = new Map<number, number>();
  const sk = (i: number, j: number, d: number) => (j * GX + i) * 4 + d;
  const heap: [number, number, number, number][] = []; // cost, i, j, dir
  const push = (e: [number, number, number, number]) => {
    heap.push(e);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p][0] <= heap[k][0]) break;
      [heap[p], heap[k]] = [heap[k], heap[p]];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1;
        const r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[m], heap[k]] = [heap[k], heap[m]];
        k = m;
      }
    }
    return top;
  };
  for (let d = 0; d < 4; d++) {
    best.set(sk(s.i, s.j, d), 0);
    push([0, s.i, s.j, d]);
  }
  let end = -1;
  while (heap.length) {
    const [cost, i, j, d] = pop();
    const here = sk(i, j, d);
    if (cost > (best.get(here) ?? Infinity)) continue;
    if (i === g.i && j === g.j) {
      end = here;
      break;
    }
    DIRS.forEach(([di, dj], nd) => {
      const ni = i + di;
      const nj = j + dj;
      if (!ok(ni, nj)) return;
      const c = cost + 1000 + (nd === d ? 0 : 1);
      const k = sk(ni, nj, nd);
      if (c < (best.get(k) ?? Infinity)) {
        best.set(k, c);
        prev.set(k, here);
        push([c, ni, nj, nd]);
      }
    });
  }
  if (end < 0) return [{ ...to }]; // nothing free: step straight (never expected; the harness would flag it)
  const cells: Pt[] = [];
  for (let k: number | undefined = end; k !== undefined; k = prev.get(k)) {
    const c = k >> 2;
    cells.push(ptOf(c % GX, Math.floor(c / GX)));
  }
  cells.reverse();
  // keep the corners only
  const out: Pt[] = [];
  for (let n = 1; n < cells.length; n++) {
    const a = cells[n - 1];
    const b = cells[n];
    const c = cells[n + 1];
    if (!c || (b.x - a.x !== c.x - b.x) || (b.y - a.y !== c.y - b.y)) out.push(b);
  }
  out[out.length - 1] = { ...to };
  return out;
}

export type Accessory = "crown" | "cap" | "glasses" | "headphones" | "bow" | "beanie" | "tie" | "scarf" | "visor" | "flower";
export type Look = { shirt: string; hair: string; skin: string; accessory: Accessory };

// One look per family member, the same on the world, the list and the dialogue box. Shirts are distinct hues; the
// accessory tells two members apart even without colour.
const LOOKS: Record<string, Look> = {
  "the-ceo": { shirt: "#3b4a9e", hair: "#2b1d14", skin: "#e8b58f", accessory: "crown" },
  "lead-gen": { shirt: "#2f8f5b", hair: "#6b3e1f", skin: "#c98b62", accessory: "cap" },
  "lead-enricher": { shirt: "#1f8fa6", hair: "#1c1c1c", skin: "#f1c7a3", accessory: "glasses" },
  "outreach-writer": { shirt: "#b8457a", hair: "#a0522d", skin: "#e0a77f", accessory: "bow" },
  "package-designer": { shirt: "#8a5cc7", hair: "#e3c16f", skin: "#f3d0b4", accessory: "beanie" },
  "research-analyst": { shirt: "#c4862b", hair: "#3a2a20", skin: "#b07a55", accessory: "headphones" },
  "desk-agent": { shirt: "#5d6b78", hair: "#4a4a4a", skin: "#d9a47e", accessory: "tie" },
  "jobless-bot": { shirt: "#7a8f3a", hair: "#2a2a2a", skin: "#8d5a3b", accessory: "scarf" },
  "onion-reader": { shirt: "#9e5a3b", hair: "#d8d0c0", skin: "#efc9a8", accessory: "visor" },
  scout: { shirt: "#3d7f86", hair: "#7a4b2a", skin: "#caa07c", accessory: "flower" },
};
const SPARE: Look[] = [
  { shirt: "#4f6fb3", hair: "#3b2a1a", skin: "#e2b08b", accessory: "cap" },
  { shirt: "#a8553f", hair: "#1e1e1e", skin: "#c48a64", accessory: "glasses" },
  { shirt: "#5a9a7a", hair: "#8a5a32", skin: "#f0c8a6", accessory: "beanie" },
  { shirt: "#946bb0", hair: "#2a2018", skin: "#a8724c", accessory: "headphones" },
];

export function lookOf(slug: string): Look {
  if (LOOKS[slug]) return LOOKS[slug];
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return SPARE[h % SPARE.length];
}

/** The dialogue box for a member: its lines, top to bottom. Questions and interests come before the last action (owner,
 *  10-30, as on the bot page); the model line names the provider its last call used, never the configured fallback. */
export function dialogue(c: BotCard): { title: string; lines: string[]; href: string } {
  const lines: string[] = [];
  lines.push(c.state.why ? `${capital(c.state.word)} · ${c.state.why}` : capital(c.state.word));
  if (c.on) lines.push(`${c.onKind === "thought" ? "Thinking" : c.onKind === "question" ? "Question" : "Working on"}: ${c.on.replace(" · step ", ", step ")}`);
  if (c.questions?.length) lines.push(`Asking: ${c.questions.join(" · ")}`);
  if (c.interests?.length) lines.push(`Interested in: ${c.interests.join(", ")}`);
  lines.push(c.last ? `Last: ${c.last.words}, ${c.last.ago}` : "Last: no accepted action yet");
  const out = c.output ? `${c.output.today} ${c.output.label}${c.output.today === 1 ? "" : "s"} today` : `${c.actionsToday} actions today`;
  lines.push(c.refusedShare === null ? out : `${out} · refused ${Math.round(c.refusedShare * 100)}%`);
  if (c.model) lines.push(`Model: ${c.model.label} (last call ${c.model.ts.slice(11, 16)})`);
  return { title: `${c.name} ${c.handle}`.trim(), lines, href: `/work-plan#${c.slug}` };
}

const capital = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export type Bubble = { slug: string; text: string; until: number };
export const BUBBLE_MS = 5000;

/** Speech bubbles for the members whose last accepted action is newer than in the previous poll (none on the first). */
export function newBubbles(prev: BotCard[] | null, next: BotCard[], now: number): Bubble[] {
  if (!prev) return [];
  const before = new Map(prev.map((c) => [c.slug, c.last?.ts ?? ""]));
  return next
    .filter((c) => c.last && before.has(c.slug) && c.last.ts > (before.get(c.slug) ?? ""))
    .map((c) => ({ slug: c.slug, text: c.last!.words, until: now + BUBBLE_MS }));
}

/** The "7 days" tab of a member's text box (the Family review's numbers): actions and refused share,
 *  accepted outputs by type, crashes, and how long since its last output of its own kind ("late" when overdue). */
type Week7Like = {
  actions: number;
  refused: number;
  refusedShare: number;
  outputs: Record<string, number>;
  crashes: number;
  lastCrash: string | null;
  lastOutput: { label: string; ago: string; late: boolean } | null;
};
const OUT_WORD: Record<string, string> = { lead: "leads", update_lead: "lead updates", note: "notes", task: "tasks", message: "messages", publish_package: "packages published", package: "packages", say: "chat replies", ask: "questions asked" };

export function week7Lines(w: Week7Like | undefined): string[] {
  if (!w) return ["The 7-day numbers are still being read."];
  const out = Object.entries(w.outputs)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `${n} ${OUT_WORD[t] ?? t.replace(/_/g, " ")}`);
  return [
    `${w.actions} actions · ${w.refused} refused (${Math.round(w.refusedShare * 100)}%)`,
    out.length ? `Accepted: ${out.join(", ")}` : "Accepted: nothing yet",
    w.crashes ? `Crashes: ${w.crashes}${w.lastCrash ? ` (last ${w.lastCrash})` : ""}` : "Crashes: none",
    w.lastOutput ? `Last ${w.lastOutput.label}: ${w.lastOutput.ago}${w.lastOutput.late ? " (overdue)" : ""}` : "",
  ].filter(Boolean);
}

/** The downtime line over the room, for the last 24 hours: when the Mac was off and when the family was quiet. */
export function downtimeLine(d: { off: { note: string }[]; quiet: { note: string }[]; offMin: number; quietMin: number } | null): string {
  if (!d) return "";
  if (!d.off.length && !d.quiet.length) return "Last 24 h: the Mac was on and nobody was quiet.";
  const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
  const parts: string[] = [];
  if (d.off.length) parts.push(`Mac off ${hm(d.offMin)}${d.off.some((s) => s.note === "no clean shutdown logged") ? " (no clean shutdown)" : ""}`);
  if (d.quiet.length) {
    const why = [...new Set(d.quiet.map((s) => s.note.replace(/ \(still quiet\)$/, "").trim()).filter(Boolean))];
    parts.push(`quiet ${hm(d.quietMin)}${why.length ? ` (${why.join(", ")})` : ""}`);
  }
  return `Last 24 h: ${parts.join(" · ")}.`;
}

/** What a member's monitor shows: its last accepted action as a tiny web page, a search box or a
 *  document; a dark screen with the clock while it rests or the family is quiet; a red "!" page while blocked; static
 *  noise for the first seconds of a model failure; a dim screen when idle or silent. `compact` (phone width): the
 *  domain or the title only. */
export type Monitor =
  | { mode: "web"; bar: string; lines: string[] }
  | { mode: "search"; bar: string; lines: string[] }
  | { mode: "doc"; bar: string; lines: string[] }
  | { mode: "dark"; bar: string; lines: string[] }
  | { mode: "alert" | "static" | "dim"; bar: string; lines: string[] };

export function monitorOf(c: Pick<BotCard, "state" | "last">, o: { compact?: boolean; noise?: boolean } = {}): Monitor {
  const anim = animOf(c.state);
  if (o.noise) return { mode: "static", bar: "", lines: [] };
  if (anim === "resting" || anim === "quiet") return { mode: "dark", bar: restUntil(c.state), lines: [] };
  if (anim === "blocked") return { mode: "alert", bar: "!", lines: [] };
  if (anim === "lost" || anim === "idle" || !c.last) return { mode: "dim", bar: "", lines: [] };
  const sc: Screen = c.last.screen ?? { kind: "other", domain: "", title: c.last.words };
  if (sc.kind === "web") return { mode: "web", bar: sc.domain || "reading…", lines: o.compact || !sc.title ? [] : [sc.title] };
  if (sc.kind === "search") return { mode: "search", bar: "search", lines: [sc.title] };
  return { mode: "doc", bar: o.compact ? "" : c.last.words.split(" ")[0], lines: [sc.title] };
}

// ---- Polish (commit 2) ----

export type DayPhase = { phase: "night" | "dawn" | "day" | "dusk"; sky: string; glow: string; dark: number; lamps: boolean };

/** The room by the Mac's clock: the window's sky, how dark the room is (an overlay's alpha), and whether the desk lamps
 *  are on (from 18:00 until 7:00). */
export function dayPhase(hour: number, minute = 0): DayPhase {
  const t = hour + minute / 60;
  const lamps = t >= 18 || t < 7;
  if (t >= 6 && t < 7.5) return { phase: "dawn", sky: "#f6c99a", glow: "#fff1d6", dark: 0.12, lamps };
  if (t >= 7.5 && t < 17) return { phase: "day", sky: "#a9dcef", glow: "#e6f6fc", dark: 0, lamps };
  if (t >= 17 && t < 19.5) return { phase: "dusk", sky: "#f2a46b", glow: "#ffd9b0", dark: 0.14, lamps };
  return { phase: "night", sky: "#1d2547", glow: "#3b4a8a", dark: 0.3, lamps };
}

type Prompt =
  | { kind: "proposal"; id: string; title: string; lines: string[] }
  | { kind: "decision"; id: string; title: string; lines: string[]; options: string[]; link: { label: string; href: string } | null }
  | { kind: "done"; id: "done"; title: string; lines: string[] };

type BoardPrompts = {
  proposals: { id: string; bot: string; change: string; reason: string; metric: string; expected: string; validator: string }[];
  decisions: { id: string; since: string; text: string; options: string[]; link: { label: string; href: string } | null }[];
};

/** The bulletin board's prompts, one at a time: each open CEO proposal (Yes = approve, No = decline), then each open
 *  owner's decision with its own options, Done and Later (queue 32), each until answered in this visit; "done" when
 *  nothing is pinned. */
export function nextPrompt(b: BoardPrompts, answered: ReadonlySet<string>): Prompt {
  const p = b.proposals.find((x) => !answered.has(x.id));
  if (p) {
    const lines = [p.change];
    if (p.reason) lines.push(`Why: ${p.reason}`);
    if (p.metric || p.expected) lines.push(`Measure: ${p.metric || "—"}${p.expected ? `, expected ${p.expected}` : ""}`);
    if (p.validator) lines.push(`Validator: ${p.validator}`);
    lines.push("Approve it?");
    return { kind: "proposal", id: p.id, title: `The CEO proposes, for ${p.bot}`, lines };
  }
  const left = b.decisions.filter((x) => !answered.has(x.id));
  const d = left[0];
  if (d)
    return {
      kind: "decision",
      id: d.id,
      title: `Decision waiting for you${left.length > 1 ? ` (1 of ${left.length})` : ""}${d.since ? ` · since ${d.since.slice(5, 10)}` : ""}`,
      lines: [d.text],
      options: d.options,
      link: d.link,
    };
  return { kind: "done", id: "done", title: "Bulletin board", lines: ["Nothing pinned for you right now."] };
}

/** The POST body for a Yes or No on a proposal: the same call as the proposals box. */
export const answerBody = (id: string, yes: boolean, note: string) => ({ id, action: yes ? "approve" : "decline", note: note.trim().slice(0, 300) });

type Idle = "stretch" | "sip" | "glance" | null;
const IDLES: Idle[] = ["stretch", "sip", "glance"];

/** A working member's small move between keystrokes, so it never freezes: every 14 s, for 1.6 s, one of a stretch, a
 *  sip of coffee or a glance at the window, staggered by member. */
export function idleOf(slug: string, t: number): Idle {
  let h = 0;
  for (const c of slug) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const period = 14_000;
  const at = (t + (h % period)) % period;
  if (at > 1600) return null;
  return IDLES[Math.floor((t + (h % period)) / period + h) % IDLES.length];
}

// ---- The owner's controls: what the text box asks before it acts ----
export type Action = "pause" | "resume" | "stop" | "start" | "bringback";
export type PauseFor = "30m" | "2h" | "tomorrow";

/** The question the box asks first, and the button words (Pokémon style: Yes / No). */
export function confirmText(action: Action, name: string, choice?: PauseFor): string {
  if (action === "pause") return `Pause ${name} ${choice === "30m" ? "for 30 minutes" : choice === "2h" ? "for 2 hours" : "until tomorrow morning"}?`;
  if (action === "resume") return `Let ${name} get back to work now?`;
  if (action === "stop") return `Send ${name} home? It stops until you start it again.`;
  if (action === "bringback") return `Bring ${name} back from retirement? Its launch agents are recreated and it starts.`;
  return `Wake ${name} and bring it back to its desk?`;
}


// ---- The member panel: on desktop right of the room, on a phone under it; no pop-ups ----
export type PanelTab = "info" | "screen" | "feed";
export type Panel = { open: boolean; tab: PanelTab };
type PanelEvent = "member" | "desk" | "next" | "close" | "expand";

/** A member clicked opens the panel on Info; a desk or monitor opens it on Screen; the next member (click or arrow)
 *  keeps the tab; close collapses it to a thin strip; the strip expands it again. */
export function panelNext(p: Panel, ev: PanelEvent): Panel {
  if (ev === "member") return { open: true, tab: "info" };
  if (ev === "desk") return { open: true, tab: "screen" };
  if (ev === "close") return { ...p, open: false };
  return { ...p, open: true };
}

// ---- The room's simulation (2026-10-31 overnight) ----
// The characters' state machine as it runs, kept apart from the canvas so a recorded day can be replayed through it:
//   poll (every 12 s, simPoll): each bot is "run" (a card) or "stop" (asleep in the corner). A change counts only when
//     two polls in a row agree, so one flicker in the data never flips the room. Its animation (animOf of its state
//     word) is debounced the same way. Desks, sofa seats, mats and the terminal are reserved per bot and kept stable:
//     a bot keeps its desk while it exists, whatever the order of the cards.
//   step (every frame, simStep): a member at rest picks where it should be (its desk by default; the sofa while
//     resting; the terminal now and then while working, one visitor at a time; its mat when the owner stopped it) and
//     walks there along the aisles with eased speed. A walk always finishes: quiet stops new walks, never one under way.
//     Reduced motion: no walks, everyone simply is where they belong.
//   figures: where each member is drawn and in which pose; there is always a pose, and only a walker is off a spot.

export const SPEED = 3; // tiles per second at full pace
const TRIP_MIN = 25_000;
const TRIP_SPAN = 35_000;
const AT_TERMINAL = 3_000;

type Goal = "desk" | "terminal" | "sofa" | "bed";
type Member = {
  slug: string;
  desk: number;
  anim: Anim;
  pend: Anim | null;
  pos: Pt;
  spot: Pt; // the last spot it stood still on
  path: Pt[];
  walked: number; // seconds into the current walk, for easing
  facing: 1 | -1;
  trip: "none" | "go" | "there" | "back";
  tripAt: number;
  until: number;
  sofa: number | null;
  leaving: boolean; // stopped by the owner: walking to its mat
};
type Seen = { kind: "run" | "stop"; pend: "run" | "stop" | null };
type Sim = { members: Map<string, Member>; seen: Map<string, Seen>; desks: (string | null)[]; sofa: (string | null)[]; beds: string[]; terminal: string | null; polls: number; rng: () => number };

export function newSim(rng: () => number = Math.random): Sim {
  return { members: new Map(), seen: new Map(), desks: Array.from({ length: MAX_DESKS }, () => null), sofa: Array.from({ length: 5 }, () => null), beds: [], terminal: null, polls: 0, rng };
}

const eq = (a: Pt, b: Pt) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
export const bedOf = (sim: Sim, slug: string): Pt => bedSpot(Math.max(0, sim.beds.indexOf(slug)));

/** A new poll of the board: who runs, who sleeps, each one's state word. */
export function simPoll(sim: Sim, cards: { slug: string; state: { word: string } }[], stopped: { slug: string }[], t: number) {
  const first = sim.polls === 0;
  sim.polls++;
  const now = new Map<string, "run" | "stop">();
  cards.slice(0, MAX_DESKS).forEach((c) => now.set(c.slug, "run"));
  stopped.forEach((s) => now.set(s.slug, "stop"));
  // presence, debounced
  for (const [slug, kind] of now) {
    const s = sim.seen.get(slug);
    if (!s || first) sim.seen.set(slug, { kind, pend: null });
    else if (s.kind === kind) s.pend = null;
    else if (s.pend === kind) sim.seen.set(slug, { kind, pend: null });
    else s.pend = kind;
  }
  for (const slug of [...sim.seen.keys()]) if (!now.has(slug)) sim.seen.delete(slug);
  // mats: stable, a new sleeper takes the next one
  sim.beds = sim.beds.filter((s) => sim.seen.get(s)?.kind === "stop" && !sim.members.get(s)?.leaving);
  for (const [slug, s] of sim.seen) if (s.kind === "stop" && !sim.beds.includes(slug)) sim.beds.push(slug);
  // members
  for (const c of cards.slice(0, MAX_DESKS)) {
    const s = sim.seen.get(c.slug);
    const anim = animOf(c.state);
    let m = sim.members.get(c.slug);
    if (s?.kind !== "run") continue; // not yet confirmed as running (one poll of a flicker)
    if (!m) {
      const free = sim.desks.indexOf(null);
      if (free < 0) continue;
      sim.desks[free] = c.slug;
      const seat = desk(free).seat;
      const fromBed = sim.beds.includes(c.slug) ? bedOf(sim, c.slug) : null; // started by the owner: it gets up
      m = { slug: c.slug, desk: free, anim, pend: null, pos: { ...(fromBed ?? seat) }, spot: { ...(fromBed ?? seat) }, path: [], walked: 0, facing: 1, trip: "none", tripAt: t + TRIP_MIN + sim.rng() * TRIP_SPAN, until: 0, sofa: null, leaving: false };
      sim.members.set(c.slug, m);
      sim.beds = sim.beds.filter((b) => b !== c.slug);
      continue;
    }
    m.leaving = false;
    if (first || anim === m.anim) m.pend = null;
    else if (m.pend === anim) {
      m.anim = anim;
      m.pend = null;
    } else m.pend = anim;
  }
  for (const m of sim.members.values()) {
    const s = sim.seen.get(m.slug);
    if (s?.kind === "stop") {
      m.leaving = true;
      if (!sim.beds.includes(m.slug)) sim.beds.push(m.slug);
    } else if (!s) drop(sim, m); // gone from the board altogether
  }
}

function drop(sim: Sim, m: Member) {
  sim.members.delete(m.slug);
  sim.desks = sim.desks.map((d) => (d === m.slug ? null : d));
  sim.sofa = sim.sofa.map((d) => (d === m.slug ? null : d));
  if (sim.terminal === m.slug) sim.terminal = null;
}

/** Where a member at rest should be now, reserving the sofa seat or the terminal it takes. */
function goalOf(sim: Sim, m: Member, t: number, o: { quiet: boolean; still: boolean }): { pt: Pt; goal: Goal } {
  const seat = desk(m.desk).seat;
  if (m.leaving) return { pt: bedOf(sim, m.slug), goal: "bed" };
  if (m.anim === "resting") {
    if (m.sofa === null) {
      const free = sim.sofa.indexOf(null);
      if (free >= 0) {
        sim.sofa[free] = m.slug;
        m.sofa = free;
      }
    }
    if (m.sofa !== null) return { pt: sofaSeat(m.sofa), goal: "sofa" };
  } else if (m.sofa !== null && !o.quiet) {
    // its seat is freed when it gets up, never while quiet keeps it sitting there
    sim.sofa[m.sofa] = null;
    m.sofa = null;
  }
  if (m.sofa !== null) return { pt: sofaSeat(m.sofa), goal: "sofa" }; // quiet: stays on the sofa it is on
  if (m.anim !== "working" || o.still) {
    if (eq(m.pos, TERMINAL) && o.quiet) return { pt: TERMINAL, goal: "terminal" }; // quiet: stays at the terminal it holds
    m.trip = "none";
    if (sim.terminal === m.slug) sim.terminal = null;
    return { pt: seat, goal: "desk" };
  }
  if (m.trip === "none" && !o.quiet && t > m.tripAt && eq(m.pos, seat) && sim.terminal === null) {
    m.trip = "go";
    sim.terminal = m.slug;
  }
  if (m.trip === "none" && t > m.tripAt && sim.terminal !== null && sim.terminal !== m.slug) m.tripAt = t + 5_000; // busy: later
  if (m.trip === "go" || m.trip === "there") return { pt: TERMINAL, goal: "terminal" };
  return { pt: seat, goal: "desk" };
}

/** One frame: t in ms, dt in seconds. */
export function simStep(sim: Sim, t: number, dt: number, o: { quiet: boolean; still: boolean }) {
  for (const m of [...sim.members.values()]) {
    if (!m.path.length) {
      // arrived somewhere: settle the trip, then pick the next goal
      if (m.trip === "go" && eq(m.spot, TERMINAL)) {
        m.trip = "there";
        m.until = t + AT_TERMINAL;
      } else if (m.trip === "there" && t > m.until) {
        m.trip = "back";
        if (sim.terminal === m.slug) sim.terminal = null;
      } else if (m.trip === "back" && eq(m.spot, desk(m.desk).seat)) {
        m.trip = "none";
        m.tripAt = t + TRIP_MIN + sim.rng() * TRIP_SPAN;
      }
      if (m.leaving && eq(m.spot, bedOf(sim, m.slug))) {
        drop(sim, m); // lies down on its mat: from now on a sleeper
        continue;
      }
      const g = goalOf(sim, m, t, o);
      if (m.trip === "back") g.pt = desk(m.desk).seat;
      if (!eq(m.spot, g.pt)) {
        if (o.still) {
          m.pos = { ...g.pt };
          m.spot = { ...g.pt };
        } else if (!o.quiet || m.leaving) {
          m.path = route(m.spot, g.pt, sim.beds.filter((b) => !sim.members.has(b) || b === m.slug).map((b) => bedOf(sim, b)));
          m.walked = 0;
        }
      }
    }
    if (m.path.length) walk(m, dt);
  }
}

/** Along the path at an eased pace: it starts and ends gently. */
function walk(m: Member, dt: number) {
  m.walked += dt;
  let left = dt * SPEED * Math.min(1, 0.4 + m.walked * 2);
  while (left > 1e-9 && m.path.length) {
    const to = m.path[0];
    const remaining = m.path.reduce((s, p, i) => s + Math.abs(p.x - (i ? m.path[i - 1].x : m.pos.x)) + Math.abs(p.y - (i ? m.path[i - 1].y : m.pos.y)), 0);
    left = Math.min(left, dt * SPEED * Math.max(0.35, Math.min(1, remaining * 1.5)));
    const dx = to.x - m.pos.x;
    const dy = to.y - m.pos.y;
    const dist = Math.abs(dx) + Math.abs(dy);
    if (Math.abs(dx) > 1e-9) m.facing = dx > 0 ? 1 : -1;
    if (dist <= left) {
      m.pos = { ...to };
      m.path.shift();
      left -= dist;
      if (!m.path.length) m.spot = { ...to };
    } else {
      if (Math.abs(dx) > 1e-9) m.pos = { x: m.pos.x + Math.sign(dx) * Math.min(Math.abs(dx), left), y: m.pos.y };
      else m.pos = { x: m.pos.x, y: m.pos.y + Math.sign(dy) * left };
      left = 0;
    }
  }
}

type FigPose = "walk" | "type" | "sit" | "stand" | "use" | "stretch" | "sip" | "glance";
type Figure = { slug: string; pos: Pt; pose: FigPose; facing: 1 | -1; where: Goal | "aisle"; anim: Anim };

/** Every member's pose: walking in the aisles, else on the spot it belongs to. Seated at the desk by default; the
 *  terminal's visitor uses it standing; the sofa sits. */
export function figures(sim: Sim, t: number, o: { quiet: boolean; still: boolean }): Figure[] {
  const out: Figure[] = [];
  for (const m of sim.members.values()) {
    const seat = desk(m.desk).seat;
    if (m.path.length) {
      out.push({ slug: m.slug, pos: m.pos, pose: "walk", facing: m.facing, where: "aisle", anim: m.anim });
      continue;
    }
    if (eq(m.pos, TERMINAL)) out.push({ slug: m.slug, pos: m.pos, pose: "use", facing: 1, where: "terminal", anim: m.anim });
    else if (m.sofa !== null && eq(m.pos, sofaSeat(m.sofa))) out.push({ slug: m.slug, pos: m.pos, pose: "sit", facing: 1, where: "sofa", anim: m.anim });
    else if (m.leaving && eq(m.pos, bedOf(sim, m.slug))) out.push({ slug: m.slug, pos: m.pos, pose: "sit", facing: 1, where: "bed", anim: m.anim });
    else {
      const idle = m.anim === "working" && !o.quiet && !o.still ? idleOf(m.slug, t) : null;
      const pose: FigPose = m.anim === "working" && !o.quiet ? (idle ?? "type") : "sit";
      out.push({ slug: m.slug, pos: seat, pose, facing: -1, where: "desk", anim: m.anim }); // turned to its monitor
    }
  }
  return out;
}
