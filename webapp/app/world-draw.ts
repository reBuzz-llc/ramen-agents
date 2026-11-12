// Pixel drawing for the lakeside world (queue 37; the office of queue 17 before it): everything is drawn here with
// rectangles, no image assets,
// so there is no licence to keep. Coordinates are logical pixels (16 per tile); the caller scales the context so a
// logical pixel is a whole number of device pixels, and text is drawn as vector text at that scale, so it stays sharp.
import { badgeText, BULLETIN, butterflyHop, butterflyPixels, COLS, flapFrame, insectPose, labelRects, MAILBOX, PIER, ROWS, SCREEN, SIGNBOARD, TILE, TREE_TRUNK, type Accessory, type BigScreen, type DayPhase, type GearRect, type Look, type Rect } from "@/lib/world";

export const W = COLS * TILE;
export const H = ROWS * TILE;
const BRAND = "#ff6600";
const INK = "#1a0d00";
/** The dashboard's plain face, for words the reader parses (queue 221): names and states keep the pixel face. */
const SANS = "system-ui, -apple-system, BlinkMacSystemFont, \"Helvetica Neue\", Arial, sans-serif";
const BRAND_DARK = "#c44e00";

type Ctx = CanvasRenderingContext2D;
const r = (c: Ctx, x: number, y: number, w: number, h: number, color: string) => {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), w, h);
};

export function text(c: Ctx, s: string, x: number, y: number, opts: { size?: number; color?: string; align?: CanvasTextAlign; bold?: boolean } = {}) {
  c.font = `${opts.bold === false ? "" : "bold "}${opts.size ?? 6}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  c.fillStyle = opts.color ?? INK;
  c.textAlign = opts.align ?? "center";
  c.textBaseline = "alphabetic";
  c.fillText(s, x, y);
}

/** The longest start of `s` that fits in `w` with an ellipsis. */
function fit(c: Ctx, s: string, w: number): string {
  if (c.measureText(s).width <= w) return s;
  let lo = 0;
  let hi = s.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (c.measureText(`${s.slice(0, mid).trimEnd()}…`).width <= w) lo = mid;
    else hi = mid - 1;
  }
  return `${s.slice(0, lo).trimEnd()}…`;
}

/** Two lines of a text in width w: the first cut at a word, the second ending in an ellipsis if still too long. */
function twoLines(c: Ctx, s: string, w: number, size: number, sans = false): [string, string] {
  c.font = sans ? `${size}px ${SANS}` : `bold ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  if (c.measureText(s).width <= w) return [s, ""];
  const words = s.split(" ");
  let first = "";
  while (words.length && c.measureText(`${first}${first ? " " : ""}${words[0]}`).width <= w) first = `${first}${first ? " " : ""}${words.shift()}`;
  if (!first) return [fit(c, s, w), ""];
  return [first, words.join(" ")];
}

/** One line of tiny text inside [x, x+w]: cut with an ellipsis, or scrolling when the desk is hovered (t >= 0). */
function line(c: Ctx, s: string, x: number, y: number, w: number, t: number, o: { size?: number; color?: string; bold?: boolean; sans?: boolean } = {}) {
  if (!s) return;
  const size = o.size ?? 2.6;
  c.font = `${o.bold ? "bold " : ""}${size}px ${o.sans ? SANS : "ui-monospace, SFMono-Regular, Menlo, monospace"}`;
  const tw = c.measureText(s).width;
  c.save();
  c.beginPath();
  c.rect(x, y - size, w, size + 1.2);
  c.clip();
  c.fillStyle = o.color ?? INK;
  c.textAlign = "left";
  c.textBaseline = "alphabetic";
  if (tw <= w) c.fillText(s, x, y);
  else if (t < 0) c.fillText(fit(c, s, w), x, y); // still: cut with an ellipsis
  else {
    // hovered: the whole text scrolls by
    const gap = 8;
    const off = ((t / 90) % (tw + gap)) | 0;
    c.fillText(s, x - off, y);
    c.fillText(s, x - off + tw + gap, y);
  }
  c.restore();
}


// ---- The lakeside (queue 37): sky, a mountain range, the lake, the shore and the terrace ----
const LAKE_TOP = 56;
const SHORE = 82; // px: the lake's edge; the stone path below it
const TERRACE = 104;

type Palette = { sky: string; glow: string; rock: string; rockDark: string; snow: string; hill: string; hillDark: string; water: string; waterLight: string; grass: string; grassDark: string; stone: string; stoneDark: string };
const PALETTES: Record<DayPhase["phase"], Palette> = {
  day: { sky: "#a9dcef", glow: "#e6f6fc", rock: "#7d8aa3", rockDark: "#5f6b84", snow: "#fbfdff", hill: "#5e9a52", hillDark: "#477d3f", water: "#4f97c4", waterLight: "#8cc4e2", grass: "#8fc06a", grassDark: "#7aad57", stone: "#d6ccb8", stoneDark: "#b9ad96" },
  dawn: { sky: "#f6c99a", glow: "#fff1d6", rock: "#8a7f93", rockDark: "#6a6178", snow: "#ffe9dc", hill: "#5d8a55", hillDark: "#476f42", water: "#9fb7cf", waterLight: "#f3d2b4", grass: "#8ab66a", grassDark: "#75a057", stone: "#d4c6b0", stoneDark: "#b6a891" },
  dusk: { sky: "#f2a46b", glow: "#ffd9b0", rock: "#7a6c86", rockDark: "#5d5270", snow: "#ffd2c0", hill: "#4f7a4c", hillDark: "#3d633c", water: "#c98a6e", waterLight: "#f2b48c", grass: "#7fa862", grassDark: "#6c9350", stone: "#cbbba3", stoneDark: "#ab9c85" },
  night: { sky: "#1d2547", glow: "#3b4a8a", rock: "#3a4466", rockDark: "#2c3452", snow: "#aab4cf", hill: "#2c4a3a", hillDark: "#223b2e", water: "#1c2d52", waterLight: "#3b5486", grass: "#3f6a4a", grassDark: "#34593e", stone: "#7c7f8c", stoneDark: "#666975" },
};

// ---- The upper band (queue 77, owner 2026-11-02: "a mountain range"): the mountain range
// over a lake as seen from its shore, drawn from a reference photo (kept out of the repo) and
// redrawn in the world's pixel style. Left to right: the broad left massif as the broad snow mass,
// the twin-peaked summit left of centre and tallest, the third peak, two more peaks, the last peak on the
// right; dark-green ridges in front; two rows of trees and small lakeside houses with warm roofs at the shore; the lake
// mirrors all of it, deep blue, slightly rippled. Each day phase has its own colours (pink snow at dawn, blue-grey at
// night) and the reflection follows. The band is static per phase, so it is drawn once into a cached canvas.

type Band = { sky: string[]; moonX?: number; milky?: boolean; snow: string; snowShade: string; rock: string; rockShade: string; ridgeFar: string; ridgeNear: string; tree: string; treeLight: string; wall: string; roof: string; roofShade: string; water: string; waterDeep: string; ripple: string };
const BANDS: Record<DayPhase["phase"], Band> = {
  day: { sky: ["#0f4fb8", "#1a5fc6", "#2a71d2", "#4287dc", "#6aa3e3", "#93bde9"], snow: "#fbfdff", snowShade: "#c8d7ee", rock: "#8592ad", rockShade: "#5d6a87", ridgeFar: "#4f6f55", ridgeNear: "#34513a", tree: "#2c5a2b", treeLight: "#46803c", wall: "#f1ece2", roof: "#c0573a", roofShade: "#94402b", water: "#1d4f9e", waterDeep: "#123a7a", ripple: "#5c8fd6" },
  dawn: { sky: ["#46549f", "#6a63aa", "#9a76ad", "#c98ca6", "#eba79c", "#f7c79a"], snow: "#ffdcd2", snowShade: "#d9aeb6", rock: "#8a7f96", rockShade: "#675d79", ridgeFar: "#506650", ridgeNear: "#384d3b", tree: "#2f4f2f", treeLight: "#476b3e", wall: "#f3e1d2", roof: "#c4614a", roofShade: "#984a37", water: "#4f669e", waterDeep: "#36477d", ripple: "#d9b4b0" },
  dusk: { sky: ["#3c4590", "#5f559b", "#9467a0", "#c97b8a", "#eb967a", "#f5b273"], snow: "#ffcdb8", snowShade: "#d29a97", rock: "#7a6a86", rockShade: "#5b4f6c", ridgeFar: "#46593f", ridgeNear: "#33452f", tree: "#2c4529", treeLight: "#41603a", wall: "#efd8c4", roof: "#b9573f", roofShade: "#8d4130", water: "#5a4f86", waterDeep: "#3e3968", ripple: "#e6a585" },
  night: { sky: ["#0b1026", "#0d152e", "#0f1c38", "#122741", "#153349", "#183d52"], moonX: 365, milky: true, snow: "#b3c3e6", snowShade: "#6f7fa6", rock: "#3d4769", rockShade: "#2c3452", ridgeFar: "#25392f", ridgeNear: "#1a2a22", tree: "#17271c", treeLight: "#213a28", wall: "#8f8c96", roof: "#5e3f3a", roofShade: "#472f2c", water: "#14244a", waterDeep: "#0d1a38", ripple: "#3d5384" },
};

// The range's skyline and the green ridges in front, as (x, y) points in logical px, from the photo (1920 px wide ->
// 384; its summits ~45 -> 6, the range's foot ~200 -> 44).
const RANGE: [number, number][] = [
  [0, 26], [18, 22], [34, 14], [46, 10], [54, 12], [60, 13], [70, 16], [78, 15], [86, 14], [96, 17], [104, 19], [120, 21], [132, 19],
  [142, 15], [150, 11], [154, 8], [157, 4], [159, 8], [161, 6], [163, 9], [167, 14], [172, 19], [180, 21], [188, 18], [192, 17], [198, 19], [208, 24],
  [222, 31], [232, 27], [240, 23], [250, 15], [258, 12], [268, 14], [278, 11], [286, 9], [296, 15], [304, 19], [320, 18], [332, 14],
  [340, 12], [350, 16], [360, 22], [376, 22], [384, 27],
];
const RIDGES: [number, number][] = [[0, 31], [30, 27], [56, 23], [74, 21], [92, 24], [116, 29], [150, 35], [184, 40], [210, 41], [240, 39], [272, 36], [300, 37], [330, 35], [360, 34], [384, 34]];
const HOUSES: [number, number][] = [[171, 6], [179, 5], [186, 7], [258, 6], [266, 5], [276, 6], [285, 7], [296, 5], [304, 6], [318, 5]];
const SNOW_FLOOR = 25; // px: the snow line on the high faces

function along(pts: [number, number][], x: number): number {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1];
    const [x1, y1] = pts[i];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / Math.max(1, x1 - x0);
  }
  return pts[pts.length - 1][1];
}
const grain = (n: number) => ((n * 2654435761) >>> 0) % 7; // a fixed pseudo-random 0..6 per column
const rangeTop = (x: number) => Math.round(along(RANGE, x) + (grain(x) === 0 ? 1 : 0));
const ridgeTop = (x: number) => Math.round(along(RIDGES, x) + Math.sin(x / 6) * 1.2);
// Two rows of round tree crowns along the shore: one every few px, each its own size, lit from the left.
type Crown = { cx: number; cy: number; r: number };
const crowns = (base: number, step: number, rMin: number): Crown[] =>
  Array.from({ length: Math.ceil(W / step) + 2 }, (_, k) => ({ cx: k * step - 2 + (grain(k * 3 + base) % 3), cy: base - (grain(k + base) % 2), r: rMin + (grain(k * 5 + base) % 2) }));
const BACK = crowns(LAKE_TOP - 9, 8, 4);
const FRONT = crowns(LAKE_TOP - 4, 7, 3);
function crownAt(row: Crown[], x: number, y: number): Crown | null {
  for (const t of row) if (Math.abs(x - t.cx) <= t.r && y >= t.cy - Math.sqrt(t.r * t.r - (x - t.cx) ** 2) - 0.5) return t;
  return null;
}

/** The band's colour at (x, y) above the lake, front to back: houses, trees, ridges, the range, the sky. */
export function bandColor(x: number, y: number, B: Band): string {
  for (const [hx, hw] of HOUSES) {
    if (x < hx || x >= hx + hw) continue;
    if (y >= LAKE_TOP - 4 && y < LAKE_TOP) return x === hx + 1 && y >= LAKE_TOP - 2 ? B.roofShade : B.wall; // walls, a door
    if (y >= LAKE_TOP - 6 && y < LAKE_TOP - 4) return y === LAKE_TOP - 6 && (x === hx || x === hx + hw - 1) ? B.ridgeNear : x > hx + hw / 2 ? B.roofShade : B.roof;
  }
  const front = crownAt(FRONT, x, y);
  if (front) return x < front.cx && y < front.cy - 1 && x > front.cx - front.r ? B.treeLight : B.tree;
  if (y >= LAKE_TOP - 2) return B.tree; // the trunks and the shade under the crowns
  const back = crownAt(BACK, x, y);
  if (back) return x < back.cx && y < back.cy - 1 ? B.treeLight : B.ridgeNear;
  const ridge = ridgeTop(x);
  if (y >= ridge) return y > ridge + 6 ? B.ridgeNear : B.ridgeFar;
  const top = rangeTop(x);
  if (y >= top) {
    const eastFace = along(RANGE, x + 3) > along(RANGE, x) + 0.4;
    // by day the face falling to the east is in shadow; at night the faces turned toward the moon are the lit ones
    const shade = B.moonX !== undefined ? (x < B.moonX ? !eastFace : eastFace) : eastFace;
    // the snow line: high and ragged, gullies of snow reaching down between rock ribs
    const snowLine = Math.max(top + 3, SNOW_FLOOR - 3 + (grain(x >> 1) % 4) * 2 + Math.round(3 * Math.sin(x / 7)));
    if (y < snowLine) return shade ? B.snowShade : B.snow;
    return shade || (y + grain(x >> 2)) % 7 === 0 ? B.rockShade : B.rock;
  }
  return skyAt(x, y, B);
}

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
/** The sky at (x, y): a gradient from the top colour to the hazy one at the ridge, in pixel steps with an ordered
 *  dither between them; at night a faint Milky Way across the upper sky, as slightly lighter pixels. */
function skyAt(x: number, y: number, B: Band): string {
  const n = B.sky.length - 1;
  const t = Math.min(1, y / 34) * n;
  const i = Math.min(n, Math.floor(t + BAYER[(y & 3) * 4 + (x & 3)] / 16));
  let c = B.sky[i];
  if (B.milky) {
    const d = Math.abs(y - (2 + x * 0.06)); // a band from upper left, falling gently to the right
    if (d < 5 && grain(x * 7 + y * 13) < 3 - Math.floor(d / 2)) c = mix(c, "#5a6aa0", 0.35);
  }
  return c;
}

function mix(a: string, b: string, k: number): string {
  const n = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [p, q] = [n(a), n(b)];
  return `#${p.map((v, i) => Math.round(v * (1 - k) + q[i] * k).toString(16).padStart(2, "0")).join("")}`;
}

/** The lake at (x, row): the band mirrored about the shore line, squeezed to the lake's height, a little rippled, and
 *  sunk toward the water's deep blue further out. */
export function lakeColor(x: number, row: number, B: Band): string {
  const src = LAKE_TOP - 1 - Math.floor(row * 2.05);
  const dx = row % 3 === 1 ? 1 : row % 5 === 3 ? -1 : 0;
  const k = Math.min(0.75, 0.38 + row * 0.014);
  if (src < 0) return mix(B.waterDeep, B.water, 0.3);
  return mix(bandColor(Math.min(W - 1, Math.max(0, x + dx)), src, B), row > 18 ? B.waterDeep : B.water, k);
}

// The night's stars: a seeded scatter (the same sky every night), thinner toward the horizon, none at or below the
// ridge; size 1 (dim, most), 2 (bright) and 3 (a few, a small cross).
const STARS: { x: number; y: number; size: 1 | 2 | 3 }[] = (() => {
  let seed = 7919;
  const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
  const out: { x: number; y: number; size: 1 | 2 | 3 }[] = [];
  for (let i = 0; i < 400 && out.length < 90; i++) {
    const x = Math.floor(rnd() * W);
    const y = Math.floor(rnd() * 30);
    if (y >= rangeTop(x) - 2 || rnd() > 1 - y / 32) continue;
    if (Math.abs(x - 365) < 10 && y < 19) continue; // not on the moon
    const k = rnd();
    out.push({ x, y, size: k < 0.06 && y < rangeTop(x) - 4 ? 3 : k < 0.28 ? 2 : 1 });
  }
  return out;
})();
// Thin high clouds by day: a few streaks each, drifting right at their own pace.
const CLOUDS: { x: number; y: number; speed: number; parts: [number, number, number][] }[] = [
  { x: 30, y: 4, speed: 900, parts: [[0, 0, 26], [6, 1, 30], [2, 2, 10]] },
  { x: 180, y: 9, speed: 1300, parts: [[0, 0, 18], [4, 1, 24]] },
  { x: 330, y: 6, speed: 1100, parts: [[0, 0, 22], [8, 1, 14]] },
];

/** Paint rows [y0, y1) of the band with `colour`, a run of one colour as one rectangle. */
function paint(c: Ctx, y0: number, y1: number, colour: (x: number, y: number) => string) {
  for (let y = y0; y < y1; y++) {
    let start = 0;
    let cur = colour(0, y);
    for (let x = 1; x <= W; x++) {
      const next = x < W ? colour(x, y) : "";
      if (next !== cur) {
        c.fillStyle = cur;
        c.fillRect(start, y, x - start, 1);
        start = x;
        cur = next;
      }
    }
  }
}

const bandCache = new Map<DayPhase["phase"], HTMLCanvasElement>();
/** The band and its reflection, rows 0 to the shore: from the cache, drawn once per phase. */
function drawBand(c: Ctx, phase: DayPhase["phase"]) {
  const B = BANDS[phase];
  let img = bandCache.get(phase);
  if (!img && typeof document !== "undefined") {
    img = document.createElement("canvas");
    img.width = W;
    img.height = SHORE;
    const g = img.getContext("2d");
    if (g) {
      paint(g, 0, LAKE_TOP, (x, y) => bandColor(x, y, B));
      paint(g, LAKE_TOP, SHORE, (x, y) => lakeColor(x, y - LAKE_TOP, B));
      bandCache.set(phase, img);
    } else img = undefined;
  }
  if (img) {
    c.imageSmoothingEnabled = false;
    c.drawImage(img, 0, 0);
  } else {
    paint(c, 0, LAKE_TOP, (x, y) => bandColor(x, y, B));
    paint(c, LAKE_TOP, SHORE, (x, y) => lakeColor(x, y - LAKE_TOP, B));
  }
}

/** The scene without its people and screens: sky, mountains, hills, the lake with their reflection and a slow ripple,
 *  the pier and its boat, the shore path, the terrace, the tree, and along the shore the post box (drafts badge), the
 *  notice board (decisions, CEO proposals, asks) and the WEB signboard (pages opened today; the visitor's domain). */
export function drawScene(
  c: Ctx,
  o: { day: DayPhase; flash?: boolean; decisions: number; proposals: number; requests?: number; drafts: number | null; web?: { opens: number; shows: string | null } | null; t: number; boat?: { out: number; rower: Look | null } },
) {
  const P = PALETTES[o.day.phase];
  drawBand(c, o.day.phase);
  const B = BANDS[o.day.phase];
  const disc = (cx: number, cy: number, rad: number, col: string) => {
    for (let y = -rad; y <= rad; y++) {
      const half = Math.round(Math.sqrt(rad * rad - y * y));
      r(c, cx - half, cy + y, half * 2 + 1, 1, col);
    }
  };
  if (o.day.phase === "night") {
    // stars in three sizes, most of them small and dim, thinning toward the horizon and never below the ridge; a few
    // twinkle slowly (one pixel brighter for a moment); the brighter ones faintly mirrored in the lake
    for (const [i, st] of STARS.entries()) {
      const twinkle = Math.floor(o.t / 700 + i * 13) % 41 === 0;
      if (st.size === 3) {
        r(c, st.x, st.y, 1, 1, twinkle ? "#f7f8ff" : "#e6eaff");
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) r(c, st.x + dx, st.y + dy, 1, 1, "#6f7cb0");
      } else r(c, st.x, st.y, 1, 1, twinkle ? "#eef1ff" : st.size === 2 ? "#c6cff2" : "#6f7ba8");
      if (st.size > 1) {
        const ry = LAKE_TOP + Math.round((LAKE_TOP - 1 - st.y) / 2.05);
        if (ry < SHORE - 1) r(c, st.x, ry, 1, 1, mix(B.water, "#c6cff2", 0.3));
      }
    }
    // the moon with a soft halo, in the clear sky over the right peak (the idle web pane holds the gap right of the third peak), and its glint on the water
    disc(365, 9, 8, mix(skyAt(365, 9, B), "#9fb0d8", 0.16));
    disc(365, 9, 6, mix(skyAt(365, 9, B), "#b9c6e6", 0.32));
    disc(365, 9, 4, "#e6ebf6");
    r(c, 363, 8, 2, 1, "#cfd6e8");
    r(c, 366, 11, 1, 1, "#cfd6e8");
    for (let k = 0; k < 4; k++) r(c, 362 + (k % 2), LAKE_TOP + 4 + k * 3, 6 - k, 1, mix(B.water, "#b9c6e6", 0.35));
  } else if (o.day.phase === "day") {
    // two or three thin high clouds drifting slowly, behind the peaks
    for (const cl of CLOUDS) {
      const x0 = Math.round(((cl.x + o.t / cl.speed) % (W + 80)) - 40);
      for (const [dx, dy, len] of cl.parts)
        for (let x = Math.max(0, x0 + dx); x < Math.min(W, x0 + dx + len); x++) if (cl.y + dy < rangeTop(x) - 1) r(c, x, cl.y + dy, 1, 1, dy ? "#d4e3f5" : "#eef5fd");
    }
  } else {
    disc(365, 9, 5, mix(skyAt(365, 9, B), "#ffd9a8", 0.6)); // a low sun at dawn and dusk
    disc(365, 9, 3, "#ffe6bf");
  }
  // a slow ripple across the lake
  const drift = Math.floor(o.t / 160);
  for (let y = LAKE_TOP + 3; y < SHORE - 2; y += 4) for (let x = (drift + y * 7) % 14; x < W; x += 14) r(c, x, y, 4, 1, B.ripple);
  // the pier and a boat beside it
  r(c, PIER.x, PIER.y, PIER.w, PIER.h, "#8a6544");
  for (let y = PIER.y + 2; y < PIER.y + PIER.h; y += 4) r(c, PIER.x, y, PIER.w, 1, "#6e4f34");
  const bob = Math.floor(o.t / 900) % 2;
  const boatX = 270 - (o.boat?.out ?? 0); // a boat trip (queue 47 pranks) rows it out and back
  r(c, boatX, 68 + bob, 18, 5, "#c0392b");
  r(c, boatX + 2, 73 + bob, 14, 2, "#8e2a20");
  r(c, boatX + 8, 62 + bob, 1, 6, "#5b4330");
  r(c, boatX + 9, 63 + bob, 5, 4, "#f2e6c9"); // a small sail
  if (o.boat?.rower) {
    const L = o.boat.rower;
    r(c, boatX + 3, 63 + bob, 4, 4, L.skin);
    r(c, boatX + 3, 62 + bob, 4, 2, L.hair);
    r(c, boatX + 2, 66 + bob, 6, 2, L.shirt);
    const oar = Math.floor(o.t / 300) % 2;
    r(c, boatX - 2 - oar, 70 + bob, 5, 1, "#6b4a2f"); // the oar dipping
  }
  // the shore path, flagstones
  r(c, 0, SHORE, W, TERRACE - SHORE, P.stone);
  for (let y = SHORE + 5; y < TERRACE; y += 7) for (let x = (y % 2) * 9; x < W; x += 18) r(c, x, y, 1, 7, P.stoneDark);
  for (let y = SHORE + 5; y < TERRACE; y += 7) r(c, 0, y, W, 1, P.stoneDark);
  r(c, 0, SHORE, W, 2, P.stoneDark);
  // the terrace: grass, a stone walk between the two rows and along the front
  r(c, 0, TERRACE, W, H - TERRACE, P.grass);
  for (let i = 0; i < 90; i++) r(c, (i * 53) % W, TERRACE + ((i * 29) % (H - TERRACE)), 2, 1, P.grassDark);
  r(c, 0, 173, W, 9, P.stone);
  r(c, 0, 173, W, 1, P.stoneDark);
  // the tree at the right edge: its shade, trunk and a round canopy
  r(c, 340, 120, W - 340, H - 120, P.grassDark);
  const tx = TREE_TRUNK.x0 * TILE;
  r(c, tx + 3, 92, 12, TREE_TRUNK.y1 * TILE - 92, "#6b4a2f");
  r(c, tx + 3, 92, 3, TREE_TRUNK.y1 * TILE - 92, "#563a24");
  r(c, tx - 3, 100, 8, 3, "#6b4a2f"); // a branch
  const [dark, mid, light] = o.day.phase === "night" ? ["#1d3a27", "#24452f", "#2e5638"] : ["#2f6a2f", "#3f7d3a", "#58a04c"];
  for (const [cx, cy, rad, col] of [[366, 84, 18, dark], [354, 92, 12, dark], [378, 94, 12, dark], [366, 80, 14, mid], [356, 88, 9, mid], [374, 88, 10, mid], [362, 76, 7, light], [372, 82, 5, light]] as const)
    for (let y = -rad; y <= rad; y++) {
      const half = Math.round(Math.sqrt(rad * rad - y * y));
      r(c, cx - half, cy + y, half * 2, 1, col);
    }
  // a plank across the trunk: who sleeps in its shade
  r(c, tx - 6, 104, 30, 8, "#c8a777");
  r(c, tx - 6, 111, 30, 1, "#8a6544");
  text(c, "stopped", tx + 9, 110, { size: 4.2, color: INK });
  // the post box at the start of the path: drafts waiting
  const mx = MAILBOX.x * TILE + 2;
  const my = MAILBOX.y * TILE;
  r(c, mx + 1, my + 4, 12, 20, "#c0392b");
  r(c, mx, my + 2, 14, 4, "#a93226");
  r(c, mx + 3, my + 9, 8, 2, INK);
  r(c, mx + 4, my + 24, 6, 4, "#5b4330");
  r(c, mx + 2, my + 28, 14, 2, "rgba(40,40,30,0.25)"); // its shadow on the path
  if (o.drafts !== null) {
    const s = badgeText(o.drafts);
    const w = 4 + s.length * 4;
    r(c, mx + 7 - w / 2, my - 6, w, 7, "#fffaf0");
    text(c, s, mx + 7, my - 0.5, { size: 5 });
  }
  // the notice board: three notes with their counts; the CEO's flashes when a proposal arrives
  const bx = BULLETIN.x * TILE;
  const by = BULLETIN.y * TILE;
  r(c, bx + 4, by + 22, 3, 10, "#5b4330");
  r(c, bx + BULLETIN.w * TILE - 7, by + 22, 3, 10, "#5b4330");
  r(c, bx, by, BULLETIN.w * TILE, 24, "#8a6544");
  r(c, bx + 2, by + 2, BULLETIN.w * TILE - 4, 20, "#c8a777");
  const notes: [number, string, string][] = [
    [o.decisions, "decide", "#fff6c9"],
    [o.proposals, "CEO", o.flash && Math.floor(o.t / 250) % 2 ? BRAND : "#ffe0c2"],
    [o.requests ?? 0, "asks", "#e3f4dc"],
  ];
  notes.forEach(([n, label, paper], i) => {
    const nx = bx + 3 + i * 15;
    r(c, nx, by + 4, 13, 16, paper);
    text(c, String(n), nx + 6.5, by + 14, { size: 7 });
    text(c, label, nx + 6.5, by + 18.5, { size: 3, bold: false });
  });
  // the WEB signboard by the pier: today's pages opened on a badge; the visitor's domain while it reads it
  const sx = SIGNBOARD.x;
  const sy = SIGNBOARD.y;
  r(c, sx + 11, sy + 16, 3, 18, "#5b4330");
  r(c, sx + 8, sy + 34, 12, 2, "rgba(40,40,30,0.25)"); // its shadow on the path
  r(c, sx, sy, 26, 18, "#2b2f36");
  r(c, sx + 1, sy + 1, 24, 16, "#14161a");
  if (o.web?.shows) text(c, o.web.shows, sx + 13, sy + 11, { size: 4, color: BRAND, bold: false });
  else {
    text(c, "WEB", sx + 13, sy + 8, { size: 5, color: "#fffaf0" });
    const glow = Math.floor(o.t / 400) % 3;
    for (let i = 0; i < 3; i++) r(c, sx + 6 + i * 5, sy + 12, 4, 1, i === glow ? BRAND : "#5b5f66");
  }
  if (o.web) {
    const s = badgeText(o.web.opens);
    const w = 4 + s.length * 4;
    r(c, sx + 13 - w / 2, sy - 8, w, 7, "#fffaf0");
    text(c, s, sx + 13, sy - 2.5, { size: 5 });
  }
}

/** The "shh" sign over the lake while the family is quiet, drawn over the dimmed scene. */
export function drawShh(c: Ctx) {
  r(c, W / 2 - 10, LAKE_TOP + 6, 20, 10, "#fffaf0");
  r(c, W / 2 - 10, LAKE_TOP + 6, 20, 1, BRAND);
  text(c, "shh", W / 2, LAKE_TOP + 14, { size: 6 });
}

/** A member's big screen on two posts (queue 37; queue 221 and the owner's 11-06 look): its name on a tab above, inside
 *  its state as a badge, what it is doing and today's counts. Hovered, a long line scrolls; working, a light sweeps the
 *  top edge. */
/** The face inside the screens and on their name tabs: JetBrains Mono once the page has loaded it (queue 232). */
let screenFace = "ui-monospace, Menlo, monospace";
export function setScreenFace(family: string) {
  if (family.trim()) screenFace = `${family.trim()}, ui-monospace, Menlo, monospace`;
}

export function drawBigScreen(
  c: Ctx,
  x: number,
  y: number,
  m: BigScreen,
  t: number,
  o: { hover?: boolean; working?: boolean; compact?: boolean; strip?: string; cssPerRoom?: number; k?: number; postsOnly?: boolean } = {},
) {
  if (o.postsOnly) {
    // the screen itself is an HTML box over the canvas (creatorCC queue 258); the canvas keeps the posts down to the wall
    const px = Math.round(x);
    const py = Math.round(y);
    r(c, px + 6, py + SCREEN.h, 2, 8, "#4a4f57");
    r(c, px + SCREEN.w - 8, py + SCREEN.h, 2, 8, "#4a4f57");
    return;
  }
  // The owner, 2026-11-06 (a26d13f, then creatorCC queue 232): the name on a tab above the frame; inside, what the member
  // is doing, today's counts over a thin meter, and a badge only when it is not working (working is the default). Every
  // word inside the frame and on the tab in JetBrains Mono at 14 CSS px with normal line spacing: the size in room pixels
  // comes from the canvas's scale, rounded to whole backing pixels, and capped where a phone's screen cannot hold 14 px.
  const w = SCREEN.w;
  const h = SCREEN.h;
  x = Math.round(x);
  y = Math.round(y);
  const k = o.k ?? 1;
  const s = Math.min(5.6, Math.round((14 / (o.cssPerRoom ?? 2.5)) * k) / k); // 14 CSS px in room px; 5.6 = what four lines and the footer fit
  const lh = Math.round(s * 1.3 * k) / k; // normal line spacing
  const face = (bold = false) => `${bold ? "bold " : ""}${s}px ${screenFace}`;
  const text = (str: string, tx: number, ty: number, tw: number, color: string, bold = false, scroll = -1) => {
    if (!str) return;
    c.font = face(bold);
    c.save();
    c.beginPath();
    c.rect(tx, ty - lh, tw, lh + 1);
    c.clip();
    c.fillStyle = color;
    c.textAlign = "left";
    c.textBaseline = "alphabetic";
    const width = c.measureText(str).width;
    if (width <= tw) c.fillText(str, tx, ty);
    else if (scroll < 0) c.fillText(fit(c, str, tw), tx, ty);
    else {
      const off = ((scroll / 90) % (width + 8)) | 0; // hovered: the whole line scrolls by
      c.fillText(str, tx - off, ty);
      c.fillText(str, tx - off + width + 8, ty);
    }
    c.restore();
  };
  const dark = m.mode === "dark";
  // the name tab on top of the frame; a state other than working rides on it as an orange badge (working is the
  // default and has none: the screen's lines say what it does)
  c.font = face(true);
  const badge = m.word === "working" ? "" : fit(c, m.word, w * 0.55);
  const badgeW = badge ? Math.ceil(c.measureText(badge).width) + 4 : 0;
  const name = fit(c, m.name, w - 4 - (badge ? badgeW + 2 : 0));
  const nameW = Math.ceil(c.measureText(name).width) + 5;
  const tabW = Math.min(w + 2, nameW + (badge ? badgeW + 2 : 0));
  const tabH = Math.ceil(lh) + 1;
  r(c, x - 1, y - tabH - 1, tabW + 1, tabH + 1, "#26282e");
  r(c, x, y - tabH, tabW - 1, tabH, "#fbfaf6");
  text(name, x + 2, y - Math.ceil(lh * 0.28), nameW - 3, INK, true, o.hover ? t : -1);
  if (badge) {
    r(c, x + nameW, y - tabH + 1, badgeW, tabH - 2, BRAND);
    text(badge, x + nameW + 2, y - Math.ceil(lh * 0.28), badgeW - 2, INK, true);
  }
  // the posts down to the wall, the frame and the glass
  r(c, x + 6, y + h, 2, 8, "#4a4f57");
  r(c, x + w - 8, y + h, 2, 8, "#4a4f57");
  r(c, x - 1, y - 1, w + 2, h + 2, "#26282e");
  const ix = x + 2;
  const iy = y + 2;
  const iw = w - 4;
  const ih = h - 4;
  const bg = dark ? "#1b2030" : m.mode === "alert" ? "#fde8e6" : m.mode === "dim" ? "#e6e3dc" : "#fbfaf6";
  r(c, ix, iy, iw, ih, bg);
  if (m.mode === "static") {
    for (let i = 0; i < iw; i += 2)
      for (let j = 0; j < ih; j += 2) {
        const v = (Math.sin(i * 12.9898 + j * 78.233 + Math.floor(t / 70)) * 43758.5453) % 1;
        const g = 60 + Math.floor(Math.abs(v) * 180);
        r(c, ix + i, iy + j, 2, 2, `rgb(${g},${g},${g})`);
      }
  }
  if (o.working) {
    const sweep = Math.floor(t / 40) % iw; // a light along the top edge while it works, kept inside the screen
    r(c, ix + sweep, iy, Math.min(8, iw - sweep), 1, "rgba(255,102,0,0.7)");
  }
  const ink = dark ? "#e6e9f2" : m.mode === "alert" ? "#8a1c13" : INK;
  const soft = dark ? "#aab3cc" : "#4d4d4d";
  let row = iy + 1 + lh * 0.8; // the first baseline
  if (m.four.length) {
    // the owner's four lines (creatorCC queue 233): output and goal, the item it is on (the square marks a page or a
    // search), the provider and how fresh, the last 30 minutes' allowed actions
    m.four.forEach((ln, i) => {
      const marked = i === 1 && m.mark;
      if (marked) r(c, ix + 1, Math.round(row - s * 0.62), 3, 3, m.mark === "web" ? "#d63b3b" : BRAND);
      const lx = marked ? ix + 5 : ix + 1;
      text(ln, lx, row, ix + iw - 1 - lx, i === 1 ? ink : soft, i === 1, i === 1 && o.hover ? t : -1);
      row += lh;
    });
  } else {
    // what it is doing (a card without the four facts): the site then the page, a search, "until 13:48" and why
    const icon = m.mode === "web" ? "#d63b3b" : m.mode === "search" ? BRAND : "";
    const left = icon ? ix + 5 : ix + 1;
    if (icon) r(c, ix + 1, Math.round(row - s * 0.62), 3, 3, icon);
    const first = m.lines[0] ?? "";
    const rest = m.lines.slice(1).join(" · ");
    c.font = face(true);
    const [a, b] = rest ? [first, rest] : twoLinesIn(c, first, ix + iw - 1 - left);
    text(a, left, row, ix + iw - 1 - left, ink, true, o.hover ? t : -1);
    text(b, ix + 1, row + lh, iw - 2, rest ? soft : ink, false, o.hover ? t : -1);
  }
  // today's counts, the refused share's meter on its own row under them
  const meter = m.share !== null;
  text(m.foot, ix + 1, iy + ih - (meter ? 3 : 1.5), iw - 2, soft);
  if (meter) {
    r(c, ix + 1, iy + ih - 2, iw - 2, 1, dark ? "#3a4258" : "#e2dccf");
    r(c, ix + 1, iy + ih - 2, Math.max(1, Math.round((iw - 2) * Math.min(1, m.share ?? 0))), 1, BRAND);
  }
  // a new Validator flag: one red line for 10 s (queue 40)
  if (o.strip) {
    r(c, ix, iy + ih - Math.ceil(lh) - 1, iw, Math.ceil(lh) + 1, "#d63b3b");
    text(o.strip, ix + 1, iy + ih - 2, iw - 2, "#ffffff", true, t);
  }
}

/** A line split in two at a word where it would overflow, in the font already set. */
function twoLinesIn(c: Ctx, str: string, width: number): [string, string] {
  if (c.measureText(str).width <= width) return [str, ""];
  const words = str.split(" ");
  let first = "";
  while (words.length && c.measureText(`${first}${first ? " " : ""}${words[0]}`).width <= width) first = `${first}${first ? " " : ""}${words.shift()}`;
  return first ? [first, words.join(" ")] : [fit(c, str, width), ""];
}

/** The working badge's green: light enough that near-black text on it passes WCAG AA. */
export const BADGE_GOOD = "#5cc77a";

/** The low stone wall a member stands in front of (or sits on), centred under its screen (screen's left edge x). */
export function drawWall(c: Ctx, x: number, y: number) {
  const w = 44;
  const wx = x + (SCREEN.w - w) / 2;
  r(c, wx, y, w, 8, "#a99f8c");
  r(c, wx, y, w, 2, "#c4baa6");
  for (let i = 7; i < w; i += 11) r(c, wx + i, y + 2, 1, 6, "#8f8573");
  r(c, wx, y + 8, w, 2, "rgba(40,40,30,0.25)");
}


/** One floating screen over the lake (queue 39): translucent, a thin light frame, a soft glow at night; the page's
 *  picture scaled to cover it when the ring has one, else its card (the domain large, the title under it, the bot's
 *  colour strip); the caption under it. */
export function drawFloating(
  c: Ctx,
  f: { rect: Rect; alpha: number; role: string },
  card: { domain: string; title: string; color: string; caption: string },
  img: HTMLImageElement | null,
  night: boolean,
) {
  const { x, y, w, h } = f.rect;
  c.save();
  c.globalAlpha = f.alpha;
  if (night) {
    c.fillStyle = "rgba(255, 236, 200, 0.18)";
    c.fillRect(x - 3, y - 3, w + 6, h + 6);
  }
  // glass: a thin light frame, a faint white pane the sky and the lake show through
  c.strokeStyle = "rgba(255,255,255,0.9)";
  c.lineWidth = 1;
  c.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
  if (img) {
    // cover: fill the frame, crop the overflow; smooth, as it is a photo of a page
    const k = Math.max(w / img.naturalWidth, h / img.naturalHeight);
    const sw = w / k;
    const sh = h / k;
    c.imageSmoothingEnabled = true;
    c.drawImage(img, 0, 0, sw, sh, x, y, w, h);
    c.imageSmoothingEnabled = false;
  } else {
    r(c, x, y, w, h, "rgba(251,250,246,0.62)");
    r(c, x, y, 3, h, card.color);
    const big = Math.max(5, Math.min(9, w / 11));
    line(c, card.domain, x + 6, y + big + 4, w - 9, -1, { size: big, bold: true, color: INK });
    const small = Math.max(3.4, big * 0.6);
    const [a, b] = twoLines(c, card.title, w - 9, small);
    line(c, a, x + 6, y + big + 6 + small * 1.6, w - 9, -1, { size: small, bold: false, color: "#3b3b3b" });
    line(c, b, x + 6, y + big + 6 + small * 3, w - 9, -1, { size: small, bold: false, color: "#3b3b3b" });
  }
  // the caption under it, light on the water; none while the pane is small (asleep over the sky, queue 77)
  if (w < 60) {
    c.restore();
    return;
  }
  const cs = f.role === "centre" ? 4.2 : 3.4;
  c.font = `bold ${cs}px ui-monospace, SFMono-Regular, Menlo, monospace`;
  const cw = Math.min(c.measureText(card.caption).width + 4, w + 30);
  r(c, x + w / 2 - cw / 2, y + h + 2, cw, cs + 3, "rgba(20,24,40,0.55)");
  line(c, card.caption, x + w / 2 - cw / 2 + 2, y + h + 2 + cs + 0.8, cw - 4, -1, { size: cs, bold: true, color: "#fffaf0" });
  c.restore();
}

/** A bed mat in the sleeping corner; a retired bot's is grey, with a little "R" tag. */
/** A short line under a sleeper's mat (queue 238: "owner 12:32: <reason>"), cut to `w` room px with an ellipsis. */
export function drawMatNote(c: Ctx, s: string, cx: number, y: number, w: number) {
  c.font = "3.5px ui-monospace, SFMono-Regular, Menlo, monospace";
  const t = fit(c, s, w);
  c.fillStyle = "#5b4f6b";
  c.textAlign = "center";
  c.textBaseline = "alphabetic";
  c.fillText(t, cx, y);
  c.textAlign = "left";
}

export function drawMat(c: Ctx, cx: number, cy: number, retired = false) {
  r(c, cx - 13, cy - 5, 26, 11, retired ? "#b8b8b8" : "#cdbfe0");
  r(c, cx - 13, cy - 5, 7, 11, "#fffaf0");
  if (retired) {
    r(c, cx + 8, cy + 2, 5, 5, "#6b6b6b");
    text(c, "R", cx + 10.5, cy + 6, { size: 4, color: "#ffffff" });
  }
}

export type Pose = "stand" | "walk" | "sit" | "type" | "lie" | "stretch" | "sip" | "glance" | "use";

const OUTLINE = "rgba(40, 26, 14, 0.55)";
/** A darker shade of a #rrggbb colour, for the shirt's hem. */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const d = (v: number) => Math.max(0, Math.round(v * 0.78));
  return `rgb(${d(n >> 16)}, ${d((n >> 8) & 255)}, ${d(n & 255)})`;
}

const GREY: Look = { shirt: "#8a8a8a", hair: "#6a6a6a", skin: "#b9b9b9", accessory: "cap" };

/** A member, feet at (x, y). `frame` animates walking and typing; `grey` draws a member that is stalled or silent. */
export function drawPerson(c: Ctx, x: number, y: number, look: Look, pose: Pose, frame: number, grey = false, gear: GearRect[] = []) {
  const L = grey ? { ...GREY, accessory: look.accessory } : look;
  x = Math.round(x);
  y = Math.round(y);
  if (pose === "lie") {
    drawLying(c, x, y, L);
    return drawGear(c, x, y, gear);
  }
  // a dark outline behind head and body, so the sprite reads on any floor
  r(c, x - 5, y - 19, 10, 9, OUTLINE);
  r(c, x - 5, y - 11, 10, 8, OUTLINE);
  const legs = "#2d3142";
  if (pose === "walk") {
    r(c, x - 3, y - 4, 2, frame % 2 ? 4 : 3, legs);
    r(c, x + 1, y - 4, 2, frame % 2 ? 3 : 4, legs);
  } else if (pose === "stand" || pose === "use") {
    r(c, x - 3, y - 4, 2, 4, legs);
    r(c, x + 1, y - 4, 2, 4, legs);
  } else {
    r(c, x - 3, y - 4, 6, 2, legs); // sitting: thighs only, the desk or sofa hides the rest
  }
  // body and arms
  r(c, x - 4, y - 10, 8, 6, L.shirt);
  r(c, x - 4, y - 5, 8, 1, shade(L.shirt));
  if (pose === "stretch") {
    r(c, x - 6, y - 21, 2, 11, L.shirt);
    r(c, x + 4, y - 21, 2, 11, L.shirt);
    r(c, x - 6, y - 23, 2, 2, L.skin);
    r(c, x + 4, y - 23, 2, 2, L.skin);
  } else if (pose === "sip") {
    r(c, x - 5, y - 10, 1, 5, L.shirt);
    r(c, x + 3, y - 13, 2, 4, L.skin);
    r(c, x + 1, y - 14, 3, 3, "#fffaf0");
    r(c, x + 4, y - 13, 1, 2, "#fffaf0");
    r(c, x + 1, y - 14, 3, 1, "#6b3e1f");
  } else if (pose === "use") {
    const up = frame % 2;
    r(c, x + 3, y - 9 - up, 3, 2, L.skin);
    r(c, x - 5, y - 10, 1, 5, L.shirt);
    r(c, x - 5, y - 5, 1, 1, L.skin);
  } else if (pose === "type") {
    const up = frame % 2;
    r(c, x - 5, y - 8 - up, 2, 3, L.skin);
    r(c, x + 3, y - 9 + up, 2, 3, L.skin);
  } else {
    r(c, x - 5, y - 10, 1, 5, L.shirt);
    r(c, x + 4, y - 10, 1, 5, L.shirt);
    r(c, x - 5, y - 5, 1, 1, L.skin);
    r(c, x + 4, y - 5, 1, 1, L.skin);
  }
  // head
  r(c, x - 4, y - 17, 8, 7, L.skin);
  r(c, x - 4, y - 18, 8, 3, L.hair);
  r(c, x - 4, y - 15, 1, 3, L.hair);
  r(c, x + 3, y - 15, 1, 3, L.hair);
  const eye = pose === "glance" ? -1 : 0; // a glance at the window: eyes up and to the side
  r(c, x - 2 + eye, y - 13 + eye, 1, 1, "#1b1b1b");
  r(c, x + 1 + eye, y - 13 + eye, 1, 1, "#1b1b1b");
  accessory(c, x, y, L.accessory, L);
  drawGear(c, x, y, gear);
}

/** A member's props (queue 47: its personality), as lib/world's gearRects lays them out from its feet. */
function drawGear(c: Ctx, x: number, y: number, gear: GearRect[]) {
  for (const [dx, dy, w, h, color] of gear) r(c, x + dx, y + dy, w, h, color);
}

function accessory(c: Ctx, x: number, y: number, a: Accessory, L: Look) {
  switch (a) {
    case "crown":
      r(c, x - 4, y - 20, 8, 2, "#f2c94c");
      r(c, x - 4, y - 22, 1, 2, "#f2c94c");
      r(c, x - 1, y - 23, 2, 3, "#f2c94c");
      r(c, x + 3, y - 22, 1, 2, "#f2c94c");
      r(c, x, y - 21, 1, 1, "#d63b3b");
      break;
    case "cap":
      r(c, x - 4, y - 19, 8, 3, BRAND_DARK);
      r(c, x + 2, y - 17, 5, 1, BRAND_DARK);
      break;
    case "glasses":
      r(c, x - 3, y - 14, 3, 2, "#1b1b1b");
      r(c, x, y - 14, 3, 2, "#1b1b1b");
      r(c, x - 2, y - 13, 1, 1, "#9fd3e8");
      r(c, x + 1, y - 13, 1, 1, "#9fd3e8");
      break;
    case "headphones":
      r(c, x - 5, y - 19, 10, 1, "#2a2a2a");
      r(c, x - 6, y - 15, 2, 4, "#2a2a2a");
      r(c, x + 4, y - 15, 2, 4, "#2a2a2a");
      break;
    case "bow":
      r(c, x + 2, y - 20, 2, 2, "#f06aa6");
      r(c, x + 5, y - 20, 2, 2, "#f06aa6");
      r(c, x + 4, y - 19, 1, 1, "#c23b7a");
      break;
    case "beanie":
      r(c, x - 4, y - 20, 8, 4, "#d65a5a");
      r(c, x - 1, y - 22, 2, 2, "#fffaf0");
      break;
    case "tie":
      r(c, x, y - 10, 1, 4, "#c23b3b");
      break;
    case "scarf":
      r(c, x - 4, y - 11, 8, 2, "#e8c547");
      r(c, x + 2, y - 10, 2, 3, "#e8c547");
      break;
    case "visor":
      r(c, x - 4, y - 18, 8, 1, "#2f9a5a");
      r(c, x + 3, y - 17, 3, 1, "#2f9a5a");
      break;
    case "flower":
      r(c, x - 6, y - 19, 3, 3, "#f2c94c");
      r(c, x - 5, y - 18, 1, 1, L.shirt);
      break;
  }
}

function drawLying(c: Ctx, x: number, y: number, L: Look) {
  // asleep on a mat: head on the pillow (left), a blanket in the member's colour
  r(c, x - 12, y - 4, 7, 7, L.skin);
  r(c, x - 12, y - 5, 3, 9, L.hair);
  r(c, x - 7, y - 1, 1, 1, "#1b1b1b");
  r(c, x - 5, y - 4, 16, 8, L.shirt);
  r(c, x - 5, y - 4, 16, 2, "#fffaf0");
}

/** Rising Zzz over a sleeper or someone resting. */
export function drawZzz(c: Ctx, x: number, y: number, t: number) {
  const k = (t / 700) % 3;
  for (let i = 0; i < 3; i++) {
    const p = (k + i) % 3;
    text(c, "z", x + 3 + p * 3, y - p * 4, { size: 4 + p, color: "#5b6b9a" });
  }
}

/** A small round bubble with one sign: "!" (red, blocked), "?" (grey, silent) or "II" (blue, paused by the owner). */
export function drawSign(c: Ctx, x: number, y: number, sign: "!" | "?" | "II") {
  const bg = sign === "!" ? "#d63b3b" : sign === "II" ? "#3d5a99" : "#8a8a8a";
  r(c, x - 4, y - 9, 9, 9, bg);
  r(c, x - 3, y - 10, 7, 11, bg);
  r(c, x, y, 1, 2, bg);
  if (sign === "II") {
    r(c, x - 2, y - 7, 2, 5, "#ffffff");
    r(c, x + 1, y - 7, 2, 5, "#ffffff");
  } else text(c, sign, x + 0.5, y - 2, { size: 7, color: "#ffffff" });
}

/** A thundercloud over the head, its bolt blinking: the model provider is failing. */
export function drawStorm(c: Ctx, x: number, y: number, t: number) {
  r(c, x - 7, y - 6, 14, 4, "#6f7480");
  r(c, x - 5, y - 8, 6, 3, "#6f7480");
  r(c, x, y - 9, 5, 4, "#6f7480");
  if (Math.floor(t / 300) % 2) {
    r(c, x - 1, y - 2, 2, 2, "#f2c94c");
    r(c, x - 2, y, 2, 2, "#f2c94c");
  }
}

/** A little clock and the time a rest ends. */
export function drawClock(c: Ctx, x: number, y: number, until: string) {
  r(c, x - 13, y - 6, 26, 8, "#fffaf0");
  r(c, x - 12, y - 5, 5, 5, "#5b6b9a");
  r(c, x - 10, y - 4, 1, 2, "#fffaf0");
  text(c, until, x + 2.5, y, { size: 5 });
}

/** A thought over a member after its action (queue 40), on the path below it (queue 42). */
export function drawBubble(c: Ctx, feet: { x: number; y: number }, s: string) {
  c.font = "bold 5px ui-monospace, SFMono-Regular, Menlo, monospace";
  let t = s;
  while (c.measureText(t).width > 110 && t.length > 4) t = `${t.slice(0, -2)}…`;
  // on the path just below its feet, never over a screen (labelRects), its pointer up to it
  const b = labelRects(feet, Math.ceil(c.measureText(t).width) + 8).bubble;
  r(c, b.x, b.y, b.w, b.h, INK);
  r(c, b.x + 1, b.y + 1, b.w - 2, b.h - 2, "#ffffff");
  r(c, Math.max(b.x + 3, Math.min(b.x + b.w - 5, feet.x - 1)), b.y - 2, 3, 2, INK);
  text(c, t, b.x + b.w / 2, b.y + 7, { size: 5 });
}

/** A butterfly's or bee's card (queue 51), in the thought bubbles' style: who to whom, the time, and the message
 *  wrapped in up to three lines. Returns nothing; `place` gives the rect for a height. */
export function drawInsectCard(c: Ctx, lines: string[], place: (h: number) => { x: number; y: number; w: number; h: number }, at: { x: number; y: number }) {
  c.font = "5px ui-monospace, SFMono-Regular, Menlo, monospace";
  const inner = 120;
  const words = (lines[2] ?? "").split(/\s+/);
  const body: string[] = [];
  let cur = "";
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (c.measureText(next).width > inner && cur) {
      body.push(cur);
      cur = w;
    } else cur = next;
  }
  if (cur) body.push(cur);
  const shown = body.slice(0, 3);
  if (body.length > 3) shown[2] = fit(c, `${shown[2]} ${body.slice(3).join(" ")}`, inner);
  const h = 22 + shown.length * 7;
  const b = place(h);
  r(c, b.x, b.y, b.w, b.h, INK);
  r(c, b.x + 1, b.y + 1, b.w - 2, b.h - 2, "#ffffff");
  const tip = b.y > at.y ? b.y - 2 : b.y + b.h;
  r(c, Math.max(b.x + 3, Math.min(b.x + b.w - 5, at.x - 1)), tip, 3, 2, INK); // its pointer to the insect
  c.font = "bold 5px ui-monospace, SFMono-Regular, Menlo, monospace";
  text(c, fit(c, lines[0], inner), b.x + 4, b.y + 8, { size: 5, align: "left" });
  text(c, lines[1], b.x + 4, b.y + 15, { size: 4.5, color: "#6b6b6b", align: "left", bold: false });
  shown.forEach((l, i) => text(c, l, b.x + 4, b.y + 23 + i * 7, { size: 5, align: "left", bold: false }));
}

/** The orange marker over the member whose dialogue is open. */
export function drawMarker(c: Ctx, x: number, y: number, t: number) {
  const b = Math.floor(t / 300) % 2;
  r(c, x - 3, y - 6 - b, 7, 2, BRAND);
  r(c, x - 2, y - 4 - b, 5, 1, BRAND);
  r(c, x - 1, y - 3 - b, 3, 1, BRAND);
  r(c, x, y - 2 - b, 1, 1, BRAND);
}

/** A member's standing portrait on its own small canvas (the dialogue box and the list view): the same look. */
export function drawPortrait(canvas: HTMLCanvasElement, look: Look, grey = false, gear: GearRect[] = []) {
  const c = canvas.getContext("2d");
  if (!c) return;
  const k = canvas.width / 24; // 24 x 26: room for the props either side (queue 52)
  c.setTransform(k, 0, 0, k, 0, 0);
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, 24, 26);
  drawPerson(c, 11, 25, look, "stand", 0, grey, gear);
}

/** A member drawn facing left or right (the sprite mirrored), with a soft shadow under its feet. */
export function drawFigure(c: Ctx, x: number, y: number, look: Look, pose: Pose, frame: number, grey: boolean, facing: 1 | -1, shadow = true, gear: GearRect[] = []) {
  x = Math.round(x);
  y = Math.round(y);
  if (shadow && pose !== "lie") {
    c.fillStyle = "rgba(30, 18, 8, 0.22)";
    c.beginPath();
    c.ellipse(x, y, 5.5, 1.6, 0, 0, Math.PI * 2);
    c.fill();
  }
  if (facing === 1) return drawPerson(c, x, y, look, pose, frame, grey, gear);
  c.save();
  c.translate(2 * x, 0);
  c.scale(-1, 1);
  drawPerson(c, x, y, look, pose, frame, grey, gear);
  c.restore();
}

/** A small speech bubble with an orange dot beside the head: the agent answered the owner and it is not read yet. */
export function drawReplyDot(c: Ctx, x: number, y: number) {
  r(c, x, y - 7, 9, 6, "#fffaf0");
  r(c, x + 1, y - 8, 7, 8, "#fffaf0");
  r(c, x + 1, y - 1, 2, 2, "#fffaf0");
  r(c, x + 3, y - 6, 3, 3, BRAND);
}

// ---- What really happened, animated (queue 40) ----
const ease = (k: number) => 1 - (1 - Math.min(1, Math.max(0, k))) ** 2;

/** The prop of a member's newest action at its hands, for 2-3 s (k: 0..1 through it); the screen's top-left for the
 *  sheet, the card and the flag. */
export function drawProp(c: Ctx, kind: string, x: number, head: number, k: number, t: number, screen: { x: number; y: number }) {
  const hand = head + 12;
  switch (kind) {
    case "binoculars": // raised toward the lake
      r(c, x - 4, head + 4, 3, 3, "#2b2b2b");
      r(c, x + 1, head + 4, 3, 3, "#2b2b2b");
      r(c, x - 1, head + 5, 2, 1, "#2b2b2b");
      r(c, x - 4, head + 4, 1, 1, "#9fd3e8");
      break;
    case "tablet":
      r(c, x + 2, hand - 2, 7, 9, "#26282e");
      r(c, x + 3, hand - 1, 5, 7, Math.floor(t / 300) % 2 ? "#cfe8f7" : "#e8f3fb");
      break;
    case "laptop": {
      // on the wall in front, and a sheet flying up into its screen
      r(c, x - 7, hand + 2, 12, 1, "#9aa0a8");
      r(c, x - 6, hand - 5, 10, 7, "#26282e");
      r(c, x - 5, hand - 4, 8, 5, "#cfe8f7");
      const sx = x + (screen.x + 30 - x) * ease(k);
      const sy = hand - 6 + (screen.y + 20 - (hand - 6)) * ease(k);
      if (k < 0.95) r(c, sx - 3, sy - 4, 6, 8, "#fffaf0");
      break;
    }
    case "pin": {
      // a card carried up and pinned to the screen's frame
      const px = x + (screen.x + 56 - x) * ease(k);
      const py = hand + (screen.y + 2 - hand) * ease(k);
      r(c, px - 4, py - 3, 8, 6, "#fff3c4");
      r(c, px - 1, py - 4, 2, 2, "#d63b3b");
      break;
    }
    case "flag": {
      // a small flag runs up a pole beside the screen
      const pole = screen.x - 4;
      r(c, pole, screen.y, 1, 44, "#6b4a2f");
      const fy = screen.y + 38 - 34 * ease(k);
      r(c, pole + 1, fy, 8, 5, BRAND);
      break;
    }
    case "clipboard":
      r(c, x + 2, hand - 3, 7, 9, "#8a6544");
      r(c, x + 3, hand - 2, 5, 7, "#fffaf0");
      r(c, x + 4, hand - 3, 3, 1, "#c4c4c4");
      if (Math.floor(t / 200) % 2) r(c, x + 4, hand + 1, 3, 1, "#3b3b3b");
      break;
    // the signature moves (queue 47 part 2): each member acts with its own prop
    case "watch": // the CEO lifts its wrist and checks the time, clipboard under the arm
      r(c, x - 7, hand - 6, 3, 2, "#e8b58f");
      r(c, x - 7, hand - 7, 2, 1, "#f2c94c");
      r(c, x + 2, hand - 1, 4, 6, "#8a6544");
      r(c, x + 3, hand, 2, 4, "#fffaf0");
      if (Math.floor(t / 250) % 2) r(c, x - 8, hand - 9, 1, 1, "#fffaf0"); // a glint
      break;
    case "sweep": { // binoculars raised, sweeping the horizon
      const dx = Math.round(Math.sin(k * Math.PI * 3) * 3);
      r(c, x - 4 + dx, head + 4, 3, 3, "#2b2b2b");
      r(c, x + 1 + dx, head + 4, 3, 3, "#2b2b2b");
      r(c, x - 1 + dx, head + 5, 2, 1, "#2b2b2b");
      r(c, x - 4 + dx, head + 4, 1, 1, "#9fd3e8");
      break;
    }
    case "magnify": { // the glass up at the eye, the eye big behind it
      const bob = Math.round(Math.sin(k * Math.PI * 4));
      r(c, x + 1, head + 3 + bob, 5, 5, "#c9c4b8");
      r(c, x + 2, head + 4 + bob, 3, 3, "#bfe6f5");
      r(c, x + 3, head + 5 + bob, 1, 1, "#1b1b1b");
      r(c, x + 5, head + 8 + bob, 1, 4, "#6b4a2f");
      break;
    }
    case "toss": { // a crumpled sheet arcs into the bin by the wall
      const bx = screen.x + 59;
      const by = screen.y + 46;
      const e = ease(k);
      const px = x + 4 + (bx - x - 4) * e;
      const py = hand - 4 + (by - hand + 4) * e - Math.sin(Math.PI * e) * 14;
      if (k < 0.97) {
        r(c, px - 1, py - 1, 3, 3, "#fffaf0");
        r(c, px, py, 1, 1, "#c4c4c4");
      }
      break;
    }
    case "holdup": { // the sketch pad held up high, a drawing on it
      const lift = Math.round(ease(Math.min(1, k * 2)) * 8);
      r(c, x - 5, head - 2 - lift, 10, 8, "#fffaf0");
      r(c, x - 5, head - 2 - lift, 10, 1, "#8a5cc7");
      r(c, x - 3, head + 1 - lift, 6, 1, "#8a5cc7");
      r(c, x - 2, head + 3 - lift, 4, 1, BRAND);
      r(c, x - 6, head + 5 - lift, 2, 3, "#f3d0b4");
      r(c, x + 4, head + 5 - lift, 2, 3, "#f3d0b4");
      break;
    }
    case "glasses": { // a finger pushes the glasses up the nose, the book open in the other hand
      const up = k < 0.5 ? 1 : 0;
      r(c, x - 3, head + 6 - up, 3, 1, "#1b1b1b");
      r(c, x, head + 6 - up, 3, 1, "#1b1b1b");
      r(c, x, head + 7 - up, 1, 3, "#b07a55");
      r(c, x + 3, hand - 2, 6, 4, "#fffaf0");
      r(c, x + 5, hand - 2, 1, 4, "#c4c4c4");
      break;
    }
    case "compass": { // the compass held out, its needle spinning, then settling
      r(c, x + 3, hand - 4, 5, 5, "#c9c4b8");
      r(c, x + 4, hand - 3, 3, 3, "#fffaf0");
      const a = k < 0.8 ? t / 60 : 0;
      r(c, x + 5 + Math.round(Math.cos(a)), hand - 2 + Math.round(Math.sin(a)), 1, 1, "#d63b3b");
      r(c, x + 5, hand - 2, 1, 1, "#3b3b3b");
      break;
    }
    case "sketch": { // the pad held up in front, a pencil moving over it (queue 53)
      r(c, x + 2, hand - 6, 8, 8, "#1b1b1b");
      r(c, x + 3, hand - 5, 6, 6, "#ffffff");
      r(c, x + 3, hand - 6, 6, 1, "#8a5cc7");
      const px = x + 4 + Math.round(Math.sin(k * Math.PI * 2) * 2 + 2);
      const py = hand - 3 + Math.round(Math.cos(k * Math.PI * 4));
      r(c, px, py, 1, 1, "#8a5cc7");
      r(c, px + 1, py - 3, 1, 3, "#f2c94c"); // the pencil
      break;
    }
    case "page": { // the book open in both hands, a page turning every 3 s (queue 53)
      r(c, x - 5, hand - 4, 11, 6, "#1b1b1b");
      r(c, x - 4, hand - 3, 4, 4, "#fffaf0");
      r(c, x + 1, hand - 3, 4, 4, "#fffaf0");
      r(c, x, hand - 4, 1, 6, "#c0392b");
      if (k > 0.8) {
        const w = Math.round((1 - (k - 0.8) / 0.2) * 4);
        r(c, x + 1, hand - 5, Math.max(1, w), 4, "#e8e3d6"); // the page lifting over
      }
      break;
    }
    case "puff": // a small red puff where the refused action was
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + k * 2;
        r(c, x + Math.cos(a) * (3 + k * 6) - 1, head + 6 + Math.sin(a) * (3 + k * 5) - 1, 3, 3, `rgba(214,59,59,${0.8 * (1 - k)})`);
      }
      break;
  }
}

/** A prank between members (queue 47 part 4), drawn over the scene from the actors' feet; `k` 0..1 through it. */
export function drawGag(c: Ctx, kind: string, a: { x: number; y: number }, b: { x: number; y: number } | null, k: number, t: number, skips: number) {
  const headB = b ? { x: b.x, y: b.y - 20 } : null;
  const arc = (p: { x: number; y: number }, q: { x: number; y: number }, e: number, lift: number) => ({ x: p.x + (q.x - p.x) * e, y: p.y + (q.y - p.y) * e - Math.sin(Math.PI * e) * lift });
  switch (kind) {
    case "paperball": {
      if (!headB || k > 0.75) break;
      const p = arc({ x: a.x + 5, y: a.y - 10 }, { x: headB.x, y: headB.y + 4 }, Math.min(1, k / 0.6), 14);
      r(c, Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3, "#fffaf0");
      r(c, Math.round(p.x), Math.round(p.y), 1, 1, "#c4c4c4");
      break;
    }
    case "poke": {
      if (!headB) break;
      // the one dozing, Zzz; a long reed reaches over and taps it
      if (k < 0.6) {
        const z = Math.floor(t / 500) % 3;
        text(c, "z", headB.x + 5 + z, headB.y - 2 - z * 2, { size: 4, color: "#5b6b9a" });
      }
      const reach = Math.min(1, k / 0.55);
      const ex = a.x + 5 + (headB.x - a.x - 5) * reach;
      const ey = a.y - 9 + (headB.y + 8 - a.y + 9) * reach;
      c.strokeStyle = "#8a7a3a";
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(a.x + 5, a.y - 9);
      c.lineTo(ex, ey);
      c.stroke();
      break;
    }
    case "teacup": {
      if (!headB) break;
      // two cups swap places in mid-air
      const e = Math.min(1, Math.max(0, (k - 0.2) / 0.4));
      const p = arc({ x: a.x + 5, y: a.y - 12 }, { x: b!.x + 5, y: b!.y - 12 }, e, 8);
      const q = arc({ x: b!.x + 5, y: b!.y - 12 }, { x: a.x + 5, y: a.y - 12 }, e, -6);
      for (const [cp, col] of [[p, "#fffaf0"], [q, "#f2c94c"]] as const) {
        r(c, Math.round(cp.x) - 1, Math.round(cp.y) - 1, 3, 3, col);
        r(c, Math.round(cp.x) + 2, Math.round(cp.y), 1, 1, col);
        r(c, Math.round(cp.x) - 1, Math.round(cp.y) - 1, 3, 1, "#6b3e1f");
      }
      break;
    }
    case "stones": {
      // a flat stone skips out over the lake, a ripple at each touch, then the count
      const out = a.x < W / 2 ? 1 : -1; // toward the open water, never off the edge
      const touches = Array.from({ length: skips }, (_, i) => ({ x: a.x + out * (18 + i * 16), y: 76 - i * 3 }));
      const done = Math.min(skips, Math.floor(k * (skips + 1)));
      touches.slice(0, done).forEach((p, i) => {
        const age = k * (skips + 1) - i;
        const rad = Math.min(5, 1 + age * 2);
        c.strokeStyle = `rgba(255,255,255,${Math.max(0, 0.7 - age * 0.15)})`;
        c.lineWidth = 0.6;
        c.beginPath();
        c.ellipse(p.x, p.y, rad, rad / 3, 0, 0, Math.PI * 2);
        c.stroke();
      });
      if (done < skips) {
        const from = done === 0 ? { x: a.x, y: a.y - 10 } : touches[done - 1];
        const p = arc(from, touches[done], (k * (skips + 1)) % 1, 4);
        r(c, Math.round(p.x), Math.round(p.y), 2, 1, "#6b6b6b");
      } else text(c, `${skips} skips!`, touches[skips - 1].x, touches[skips - 1].y - 6, { size: 4, color: "#fffaf0" });
      break;
    }
  }
}

/** The ticker along the bottom edge (queue 47 part 5): a dark strip, the line scrolling left, repeated to fill it.
 *  Returns the width of one pass, so the scroll can wrap. */
export function drawTicker(c: Ctx, line: string, scroll: number, at: { x: number; y: number; w: number; h: number }): number {
  r(c, at.x, at.y, at.w, at.h, "#141821");
  r(c, at.x, at.y, at.w, 1, BRAND);
  c.font = "bold 4.5px ui-monospace, SFMono-Regular, Menlo, monospace";
  const pass = c.measureText(line + "      ").width;
  for (let x = at.x - scroll; x < at.x + at.w; x += pass) text(c, line, x, at.y + at.h - 2.5, { size: 4.5, color: "#fffaf0", align: "left" });
  return pass;
}

/** The strip under the scene (queue 50) and, beside the director's inset, who it shows and what it just did. */
export function drawStrip(c: Ctx, from: number, height: number, caption: { x: number; y: number; w: number; h: number } | null, lines: string[]) {
  r(c, 0, from, W, height - from, "#1d2433");
  if (!caption) return;
  lines.forEach((l, i) => {
    c.font = `${i === 0 ? "bold " : ""}${i === 0 ? 9 : 5.5}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    text(c, fit(c, l, caption.w - 4), caption.x + 2, caption.y + (i === 0 ? 14 : 22 + i * 9), { size: i === 0 ? 9 : 5.5, color: i === 0 ? "#fffaf0" : "#c9cfdb", align: "left", bold: i === 0 });
  });
}

/** The director's inset frame and the focus's name (the zoomed picture is copied in by the caller). */
export function drawInsetFrame(c: Ctx, rect: { x: number; y: number; w: number; h: number }, label: string) {
  c.strokeStyle = "#fffaf0";
  c.lineWidth = 1.5;
  c.beginPath();
  c.roundRect(rect.x, rect.y, rect.w, rect.h, 4);
  c.stroke();
  if (label) {
    c.font = "bold 4.5px ui-monospace, SFMono-Regular, Menlo, monospace";
    const w = c.measureText(label).width + 6;
    r(c, rect.x + 3, rect.y + 3, w, 7, "rgba(20, 24, 34, 0.7)");
    text(c, label, rect.x + 6, rect.y + 8.5, { size: 4.5, color: "#fffaf0", align: "left" });
  }
}

/** The Writer's bin by its wall (queue 47): a wire basket that fills from the bottom, one crumpled ball per accepted
 *  draft today (12 fill it to the rim). */
export function drawBin(c: Ctx, x: number, y: number, count: number) {
  r(c, x, y, 7, 8, "#4b5563");
  r(c, x + 1, y + 1, 5, 6, "#2f3540");
  for (let i = 0; i < count; i++) {
    const col = i % 3;
    const row = Math.floor(i / 3);
    r(c, x + 1 + col * 2, y + 5 - row * 2, 2, 2, i % 2 ? "#fffaf0" : "#e6e3dc");
  }
  for (let i = 2; i < 7; i += 2) r(c, x + i, y + 1, 1, 6, "rgba(75, 85, 99, 0.7)"); // the wire mesh in front
  r(c, x, y, 7, 1, "#6b7280"); // the rim
  r(c, x, y + 7, 7, 1, "#374151");
}

/** A bee carrying a line from the owner or a reply to the owner (queue 51; owner, 15:36: "the bee doesn't look like a
 *  bee"): about 12 px, side view: an oval yellow body with three black stripes, a dark round head with a white eye,
 *  two light-blue outlined wings over its back flapping between two frames at 8 Hz. It flips with its way and leans at
 *  most 15 degrees (insectPose), never spinning; a soft glow at night; the orange dot when it lands next. `t` null
 *  (reduced motion): wings still. */
export function drawBee(c: Ctx, p: { x: number; y: number }, o: { face: 1 | -1; tilt: number; next: boolean; night: boolean; t: number | null }) {
  if (o.night) {
    const g = c.createRadialGradient(p.x, p.y, 1, p.x, p.y, 10);
    g.addColorStop(0, "rgba(255,245,200,0.45)");
    g.addColorStop(1, "rgba(255,245,200,0)");
    c.fillStyle = g;
    c.fillRect(p.x - 10, p.y - 10, 20, 20);
  }
  c.save();
  c.translate(Math.round(p.x), Math.round(p.y));
  c.scale(o.face, 1);
  c.rotate(o.tilt * o.face);
  const up = o.t === null || Math.floor(o.t / 62.5) % 2 === 0; // 8 Hz
  const wing = (x: number, y: number, w: number, h: number) => {
    c.beginPath();
    c.ellipse(x, y, w, h, -0.3, 0, Math.PI * 2);
    c.fillStyle = "rgba(214, 236, 255, 0.85)";
    c.fill();
    c.strokeStyle = "#5a8bbf";
    c.lineWidth = 0.7;
    c.stroke();
  };
  if (up) {
    wing(-1.5, -5.5, 2.2, 3);
    wing(1, -5.8, 2, 2.8);
  } else {
    wing(-2, -3.5, 3, 1.4);
    wing(0.8, -3.8, 2.8, 1.3);
  }
  // the body: an oval, yellow with three black stripes, outlined
  c.beginPath();
  c.ellipse(-0.5, 0, 4.2, 2.8, 0, 0, Math.PI * 2);
  c.fillStyle = "#1b1b1b";
  c.fill();
  c.beginPath();
  c.ellipse(-0.5, 0, 3.6, 2.2, 0, 0, Math.PI * 2);
  c.fillStyle = "#f6c945";
  c.fill();
  c.fillStyle = "#1b1b1b";
  for (const sx of [-2.6, -0.6, 1.4]) c.fillRect(sx, -2.2, 1, 4.4);
  c.fillRect(-5.4, -0.4, 1.2, 0.8); // the sting
  // the head, round and dark, a white eye
  c.beginPath();
  c.arc(4.4, -0.6, 1.9, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = "#ffffff";
  c.fillRect(4.6, -1.4, 1, 1);
  if (o.next) {
    c.fillStyle = BRAND;
    c.fillRect(5.5, -5, 2, 2);
  }
  c.restore();
}

/** A butterfly carrying a message (queue 51; owner, 10-31 15:20: "instead of paper planes make it butterflies"; redrawn
 *  in queue 58): 13 px across, mirror-symmetric, two lobes a side with a notch, wings in the sender's shirt colour
 *  with a 1 px dark outline and light spots, a dark body, antennae with tips; it flaps open, half, up at about 5 Hz,
 *  flies in small hops and glides (wings held open), and flips and leans like the bee; a soft glow at night. The oldest
 *  of three has an orange ring under its body: it lands next. `t` null (reduced motion): wings open and still. */
export function drawButterfly(c: Ctx, p: { x: number; y: number; angle: number }, o: { color: string; next: boolean; night: boolean; t: number | null; seed?: number }) {
  // hops and glides (queue 58), not a sine bob
  const hop = o.t === null ? { dy: 0, glide: true } : butterflyHop(o.seed ?? 0, o.t);
  const x = Math.round(p.x);
  const y = Math.round(p.y + hop.dy);
  if (o.night) {
    const g = c.createRadialGradient(x, y, 1, x, y, 10);
    g.addColorStop(0, "rgba(255,250,225,0.45)");
    g.addColorStop(1, "rgba(255,250,225,0)");
    c.fillStyle = g;
    c.fillRect(x - 10, y - 10, 20, 20);
  }
  const px = butterflyPixels(o.t === null ? "open" : flapFrame(o.t, hop.glide), o.next);
  const pose = insectPose(p.angle); // the bee's flip and lean
  c.save();
  c.translate(x + 0.5, y + 0.5);
  c.scale(pose.face, 1);
  c.rotate(pose.tilt * pose.face);
  const dot = (ps: [number, number][], color: string) => {
    c.fillStyle = color;
    for (const [dx, dy] of ps) c.fillRect(dx - 0.5, dy - 0.5, 1, 1);
  };
  dot(px.outline, "#1b1b1b");
  dot(px.wing, o.color);
  dot(px.spots, "#fffaf0");
  dot(px.body, "#2b2b2b");
  dot(px.antennae, "#2b2b2b");
  dot(px.tips, "#1b1b1b");
  dot(px.marker, BRAND); // lands next: a ring under the body
  c.restore();
}

/** A screen's frame flashing as a plane touches it (queue 46). */
export function drawFlash(c: Ctx, sb: { x: number; y: number; w: number; h: number }) {
  c.strokeStyle = BRAND;
  c.lineWidth = 1.5;
  c.strokeRect(sb.x - 1.5, sb.y - 1.5, sb.w + 3, sb.h + 3);
}

/** A bird from the mountains to a screen, a note in its feet (k: 0..1); its wings flap. */
export function drawBird(c: Ctx, a: { x: number; y: number }, b: { x: number; y: number }, k: number, t: number) {
  const e = ease(k);
  const x = a.x + (b.x - a.x) * e;
  const y = a.y + (b.y - a.y) * e;
  const up = Math.floor(t / 150) % 2;
  r(c, x - 1, y, 3, 2, "#3b3b3b");
  r(c, x - 5, y - (up ? 2 : -1), 4, 1, "#3b3b3b");
  r(c, x + 2, y - (up ? 2 : -1), 4, 1, "#3b3b3b");
  if (k < 0.97) r(c, x - 1, y + 3, 4, 3, "#ffdcd6");
}

/** A grey bubble over a member three refusals in a row: "stuck" until an allowed action. */
export function drawStuck(c: Ctx, feet: { x: number; y: number }) {
  const g = labelRects(feet, 0).tag; // beside it at its wall's height, below every screen
  r(c, g.x, g.y, g.w, g.h, "#8a8a8a");
  r(c, g.x - 2, g.y + 3, 2, 3, "#8a8a8a");
  text(c, "stuck", g.x + g.w / 2, g.y + 6.5, { size: 5, color: "#ffffff" });
}

/** The main model provider is out: the sky greys over and a light rain falls until it answers again. */
export function drawRain(c: Ctx, t: number) {
  c.fillStyle = "rgba(110,118,130,0.45)";
  c.fillRect(0, 0, W, 56);
  for (let i = 0; i < 70; i++) {
    const x = (i * 53 + Math.floor(t / 30) * 2) % W;
    const y = (i * 37 + Math.floor(t / 18) * 3) % H;
    r(c, x, y, 1, 3, "rgba(200,215,235,0.55)");
  }
}
