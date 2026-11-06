// Pixel drawing for the office world: everything is drawn here with rectangles, no image assets,
// so there is no licence to keep. Coordinates are logical pixels (16 per tile); the caller scales the context so a
// logical pixel is a whole number of device pixels, and text is drawn as vector text at that scale, so it stays sharp.
import { BULLETIN, COLS, DESK_W, DOOR, LOUNGE, MAILBOX, NAMEPLATE, ROWS, SCREEN, TILE, type Accessory, type DayPhase, type DeskScreen, type Look } from "@/lib/world";

export const W = COLS * TILE;
export const H = ROWS * TILE;
const BRAND = "#ff6600";
const INK = "#1a0d00";
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

/** Floor, walls, windows, door, bulletin board, mailbox, web terminal, rug and plants: the room without its people. */
export function drawRoom(c: Ctx, o: { day?: DayPhase; flash?: boolean; quiet?: boolean; decisions: number; proposals: number; requests?: number; drafts: number | null; t: number }) {
  // floor: wood planks, staggered joints and a little grain
  for (let y = 2; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      const k = (x * 7 + y * 13) % 5;
      r(c, x * TILE, y * TILE, TILE, TILE, ["#cfa77c", "#c99f73", "#d2ab80", "#c79c70", "#ccA478"][k]);
      r(c, x * TILE, y * TILE + 15, TILE, 1, "#b48a60");
      if ((x + y) % 2) r(c, x * TILE + 7, y * TILE, 1, 15, "#bf966b");
      if (k === 2) r(c, x * TILE + 3, y * TILE + 6, 5, 1, "#c4996e");
    }
  // wall with a wainscot and a baseboard
  r(c, 0, 0, W, 2 * TILE, "#ece4d6");
  r(c, 0, 20, W, 9, "#e2d7c4");
  r(c, 0, 20, W, 1, "#d4c7b0");
  r(c, 0, 2 * TILE - 3, W, 3, "#8c7b67");
  const day = o.day;
  for (const wx of [1, 4, 15, 18]) {
    r(c, wx * TILE + 2, 5, 28, 20, "#6b5a48");
    r(c, wx * TILE + 4, 7, 24, 16, day?.sky ?? "#a9dcef");
    if (day?.phase === "night") {
      r(c, wx * TILE + 8, 10, 1, 1, "#fffaf0");
      r(c, wx * TILE + 21, 13, 1, 1, "#fffaf0");
      r(c, wx * TILE + 13, 18, 1, 1, "#d8dcf0");
      r(c, wx * TILE + 23, 8, 3, 3, "#f3efd8");
    } else {
      r(c, wx * TILE + 6, 9, 6, 2, day?.glow ?? "#e6f6fc");
      // weather by the time of day: clouds drift past by day, a low sun at dawn and dusk
      c.save();
      c.beginPath();
      c.rect(wx * TILE + 4, 7, 24, 16);
      c.clip();
      if (day?.phase === "day" || !day) {
        const cx = wx * TILE + 4 + ((o.t / 900 + wx * 7) % 34) - 6;
        r(c, cx, 12, 7, 2, "#ffffff");
        r(c, cx + 2, 11, 3, 1, "#ffffff");
        const cx2 = wx * TILE + 4 + ((o.t / 1400 + wx * 13 + 17) % 34) - 6;
        r(c, cx2, 17, 5, 2, "rgba(255,255,255,0.8)");
      } else {
        r(c, wx * TILE + 18, 17, 5, 5, day.phase === "dawn" ? "#ffd27a" : "#ff9a52");
      }
      c.restore();
    }
    r(c, wx * TILE + 15, 7, 2, 16, "#6b5a48");
    r(c, wx * TILE + 2, 24, 28, 2, "#5b4a3a");
  }
  // bulletin board: decisions, CEO proposals and The CEO's open requests, pinned
  const bx = BULLETIN.x * TILE;
  r(c, bx + 2, 3, BULLETIN.w * TILE - 4, 24, BRAND);
  r(c, bx + 4, 5, BULLETIN.w * TILE - 8, 20, "#c4935a");
  const notes: [number, string, string, string][] = [
    [o.decisions, "decide", "#fffaf0", "#d63b3b"],
    [o.proposals, "CEO", "#fff1a8", "#2f6fd6"],
    [o.requests ?? 0, "asks", "#dff3e4", "#2f9a5a"],
  ];
  notes.forEach(([n, label, paper, pin], i) => {
    const nx = bx + 6 + i * 18;
    const lit = i === 1 && o.flash && Math.floor(o.t / 250) % 2 === 0; // a proposal just arrived
    if (lit) r(c, nx - 1, 7, 18, 16, BRAND);
    r(c, nx, 8, 16, 14, paper);
    r(c, nx + 7, 7, 2, 2, pin);
    text(c, String(n), nx + 8, 18, { size: 7 });
    text(c, label, nx + 8, 21.5, { size: 3, bold: false });
  });
  // door, with the shh sign while the family is quiet
  const dx = DOOR.x * TILE;
  r(c, dx + 4, 2, 24, 30, "#7b5233");
  r(c, dx + 6, 4, 20, 26, "#94653f");
  r(c, dx + 22, 17, 2, 3, BRAND);
  // mailbox on the back wall, left of the door: drafts waiting
  const mx = MAILBOX.x * TILE;
  r(c, mx + 2, 12, 12, 11, BRAND);
  r(c, mx + 2, 12, 12, 2, BRAND_DARK);
  r(c, mx + 4, 16, 8, 2, INK);
  r(c, mx + 13, 9, 2, 6, "#d63b3b");
  r(c, mx + 3, 23, 10, 1, "#5b4a3a");
  if (o.drafts !== null) {
    const s = o.drafts > 999 ? "999+" : String(o.drafts);
    const w = 4 + s.length * 4;
    r(c, mx + 8 - w / 2, 2, w, 7, "#fffaf0");
    text(c, s, mx + 8, 7.5, { size: 5 });
  }
  // web terminal against the right wall at the middle aisle, beside the corridor
  const tx = 22 * TILE + 1;
  const ty = 8 * TILE + 2; // in the aisle between the desk rows
  r(c, tx + 1, ty, 14, 30, "#2b2f36");
  r(c, tx + 3, ty + 3, 10, 9, "#14161a");
  const glow = Math.floor(o.t / 400) % 3;
  for (let i = 0; i < 3; i++) r(c, tx + 4, ty + 5 + i * 2, i === glow ? 8 : 5, 1, BRAND);
  text(c, "WEB", tx + 8, ty + 20, { size: 4, color: "#fffaf0" });
  r(c, tx + 3, ty + 28, 10, 2, "#1a1c20");
  // rug by the sofa, and plants
  r(c, 1 * TILE, (10 + LOUNGE) * TILE + 6, 5 * TILE, 4, "#e7d3b0");
  plant(c, 0 * TILE + 2, (10 + LOUNGE) * TILE + 2);
  plant(c, 0 * TILE + 2, 5 * TILE + 2);
  plant(c, 23 * TILE + 1, 11 * TILE + 8);
  // sleeping corner sign
  r(c, 12 * TILE, (9 + LOUNGE) * TILE + 6, 12 * TILE, 9, "#efe7f7");
  text(c, "stopped by the owner", 18 * TILE, (9 + LOUNGE) * TILE + 13, { size: 5, bold: false, color: "#5b4f6b" });
}

/** The "shh" sign on the door while the family is quiet, drawn over the dimmed room. */
export function drawShh(c: Ctx) {
  const dx = DOOR.x * TILE;
  r(c, dx + 7, 8, 18, 9, "#fffaf0");
  r(c, dx + 7, 8, 18, 1, BRAND);
  text(c, "shh", dx + 16, 15, { size: 6 });
}

function plant(c: Ctx, x: number, y: number) {
  r(c, x + 3, y + 9, 8, 6, BRAND_DARK);
  r(c, x + 4, y + 2, 6, 7, "#3f8f4a");
  r(c, x + 2, y + 4, 3, 4, "#4fa85a");
  r(c, x + 9, y + 3, 3, 4, "#4fa85a");
}

/** A desk with its monitor facing the room (what the member is working on, see monitorOf), a keyboard by the seat and a
 *  nameplate with the member's handle. */
export function drawDesk(c: Ctx, dx: number, dy: number, handle: string, lamp = false) {
  const x = dx * TILE;
  const y = dy * TILE;
  r(c, x + 1, y + 13, DESK_W, 2, "rgba(60,40,20,0.25)"); // shadow on the floor
  r(c, x, y - 4, DESK_W, 6, "#9b7550");
  r(c, x, y - 4, DESK_W, 1, "#b38c63");
  r(c, x, y + 2, DESK_W, 10, "#7a5a3d");
  r(c, x, y + 2, DESK_W, 2, BRAND);
  r(c, x, y + 11, DESK_W, 1, "#5f4530");
  r(c, x + 1, y + 12, 3, 3, "#5b4330");
  r(c, x + DESK_W - 4, y + 12, 3, 3, "#5b4330");
  // desk lamp at the far end
  r(c, x + DESK_W - 1, y - 12, 1, 9, "#3a3a3a");
  r(c, x + DESK_W - 3, y - 14, 5, 3, lamp ? "#ffd66b" : "#5b5b5b");
  r(c, x + DESK_W - 3, y - 4, 4, 1, "#3a3a3a");
  // the keyboard (the screen stands behind the seat: drawDeskScreen)
  r(c, x + 30, y - 3, 10, 2, "#e3e3e3");
  // nameplate
  r(c, x + NAMEPLATE.x, y + NAMEPLATE.y, NAMEPLATE.w, NAMEPLATE.h, "#fffaf0");
  text(c, handle, x + NAMEPLATE.x + NAMEPLATE.w / 2, y + 10, { size: 4.5 });
}

/** A desk lamp's pool of light, drawn over the night shade so the desks read as lit. */
export function drawLampGlow(c: Ctx, dx: number, dy: number) {
  // one warm pool on the desk top under the lamp, nothing on the floor around it
  const x = dx * TILE + DESK_W - 8;
  const y = dy * TILE - 1;
  c.save();
  c.translate(x, y);
  c.scale(1, 0.45);
  const g = c.createRadialGradient(0, 0, 1, 0, 0, 16);
  g.addColorStop(0, "rgba(255, 214, 130, 0.5)");
  g.addColorStop(1, "rgba(255, 214, 130, 0)");
  c.fillStyle = g;
  c.fillRect(-16, -16, 32, 32);
  c.restore();
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




/** The sofa: back first (behind whoever sits on it), the front after. */
export function drawSofaBack(c: Ctx) {
  r(c, 1 * TILE - 4, (11 + LOUNGE) * TILE - 10, 5 * TILE + 8, 10, BRAND_DARK);
}
export function drawSofaFront(c: Ctx) {
  const x = 1 * TILE - 4;
  const y = (11 + LOUNGE) * TILE;
  r(c, x, y, 5 * TILE + 8, 9, BRAND);
  for (let i = 0; i < 5; i++) r(c, x + 5 + i * 16, y + 1, 14, 2, "#ff8a3d");
  r(c, x - 3, y - 6, 5, 15, BRAND_DARK);
  r(c, x + 5 * TILE + 6, y - 6, 5, 15, BRAND_DARK);
}

/** A bed mat in the sleeping corner; a retired bot's is grey, with a little "R" tag. */
/** A short line under a sleeper's mat ("owner 12:32: <reason>"), cut to `w` room px with an ellipsis. */
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
export function drawPerson(c: Ctx, x: number, y: number, look: Look, pose: Pose, frame: number, grey = false) {
  const L = grey ? { ...GREY, accessory: look.accessory } : look;
  x = Math.round(x);
  y = Math.round(y);
  if (pose === "lie") return drawLying(c, x, y, L);
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

/** A speech bubble with the member's newest action, kept inside the room. */
export function drawBubble(c: Ctx, x: number, y: number, s: string) {
  c.font = "bold 5px ui-monospace, SFMono-Regular, Menlo, monospace";
  let t = s;
  while (c.measureText(t).width > 110 && t.length > 4) t = `${t.slice(0, -2)}…`;
  const w = Math.ceil(c.measureText(t).width) + 8;
  const left = Math.max(2, Math.min(W - w - 2, x - w / 2));
  const top = Math.max(2, y - 12);
  r(c, left, top, w, 10, INK);
  r(c, left + 1, top + 1, w - 2, 8, "#ffffff");
  r(c, Math.max(left + 3, Math.min(left + w - 5, x - 1)), top + 10, 3, 2, INK);
  text(c, t, left + w / 2, top + 7, { size: 5 });
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
export function drawPortrait(canvas: HTMLCanvasElement, look: Look, grey = false) {
  const c = canvas.getContext("2d");
  if (!c) return;
  const k = canvas.width / 16;
  c.setTransform(k, 0, 0, k, 0, 0);
  c.imageSmoothingEnabled = false;
  c.clearRect(0, 0, 16, 26);
  drawPerson(c, 8, 25, look, "stand", 0, grey);
}

/** A member drawn facing left or right (the sprite mirrored), with a soft shadow under its feet. */
export function drawFigure(c: Ctx, x: number, y: number, look: Look, pose: Pose, frame: number, grey: boolean, facing: 1 | -1, shadow = true) {
  x = Math.round(x);
  y = Math.round(y);
  if (shadow && pose !== "lie") {
    c.fillStyle = "rgba(30, 18, 8, 0.22)";
    c.beginPath();
    c.ellipse(x, y, 5.5, 1.6, 0, 0, Math.PI * 2);
    c.fill();
  }
  if (facing === 1) return drawPerson(c, x, y, look, pose, frame, grey);
  c.save();
  c.translate(2 * x, 0);
  c.scale(-1, 1);
  drawPerson(c, x, y, look, pose, frame, grey);
  c.restore();
}

/** The desk chair behind a seated member: its back shows above the desk, beside the member. */
export function drawChair(c: Ctx, x: number, y: number) {
  x = Math.round(x);
  y = Math.round(y);
  r(c, x - 5, y - 15, 10, 9, "#3b3f4a");
  r(c, x - 4, y - 14, 8, 7, "#4a5060");
  r(c, x - 1, y - 6, 2, 3, "#2a2d35");
}

/** A coffee cup beside a resting member, its steam curling. */
export function drawCup(c: Ctx, x: number, y: number, t: number) {
  x = Math.round(x);
  y = Math.round(y);
  r(c, x - 2, y - 4, 4, 4, "#fffaf0");
  r(c, x + 2, y - 3, 1, 2, "#fffaf0");
  r(c, x - 2, y - 4, 4, 1, "#6b3e1f");
  const k = Math.floor(t / 300) % 3;
  r(c, x - 1 + (k === 1 ? 1 : 0), y - 6 - k, 1, 1, "rgba(255,255,255,0.7)");
  r(c, x + (k === 2 ? -1 : 0), y - 8 - (k % 2), 1, 1, "rgba(255,255,255,0.5)");
}

/** A draft flying from the Writer's desk to the mailbox: a folded page on an arc, `k` from 0 to 1. */
export function drawPaper(c: Ctx, from: { x: number; y: number }, to: { x: number; y: number }, k: number) {
  const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2; // ease in and out
  const x = from.x + (to.x - from.x) * e;
  const y = from.y + (to.y - from.y) * e - Math.sin(Math.PI * k) * 18;
  const flip = Math.floor(k * 10) % 2;
  r(c, x - 3, y - 2, 6, flip ? 4 : 3, "#fffaf0");
  r(c, x - 3, y - 2, 6, 1, "#c9ced8");
}

/** The face inside the screens and on their name tabs: JetBrains Mono once the page has loaded it. */
let screenFace = "ui-monospace, Menlo, monospace";
export function setScreenFace(family: string) {
  if (family.trim()) screenFace = `${family.trim()}, ui-monospace, Menlo, monospace`;
}

/** A desk's big screen, on two posts behind the seat: the name on a tab on top of the frame (a state other than working
 *  rides on it as an orange badge), then the four lines and the refused share over a thin meter, every word in JetBrains
 *  Mono at 14 CSS px with normal line spacing (the size in room px from the canvas scale, rounded to whole backing
 *  pixels, capped where a narrow canvas cannot hold 14 px). Hovered, a long line scrolls. */
export function drawDeskScreen(c: Ctx, dx: number, dy: number, m: DeskScreen, t: number, o: { hover?: boolean; cssPerRoom?: number; k?: number; postsOnly?: boolean } = {}) {
  const w = SCREEN.w;
  const h = SCREEN.h;
  const x = Math.round(dx * TILE + SCREEN.x);
  const y = Math.round(dy * TILE + SCREEN.y);
  if (o.postsOnly) {
    // the screen itself is an HTML box over the canvas (sharp text at any window size); the canvas keeps the posts
    r(c, x + 8, y + h, 2, 6, "#4a4f57");
    r(c, x + w - 10, y + h, 2, 6, "#4a4f57");
    return;
  }
  const k = o.k ?? 1;
  const s = Math.min(5.6, Math.round((14 / (o.cssPerRoom ?? 2.5)) * k) / k);
  const lh = Math.round(s * 1.3 * k) / k;
  const face = (bold = false) => `${bold ? "bold " : ""}${s}px ${screenFace}`;
  const write = (str: string, tx: number, ty: number, tw: number, color: string, bold = false, scroll = -1) => {
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
      const off = ((scroll / 90) % (width + 8)) | 0;
      c.fillText(str, tx - off, ty);
      c.fillText(str, tx - off + width + 8, ty);
    }
    c.restore();
  };
  const dark = m.mode === "dark";
  // the name tab, and the state badge on it when not working
  c.font = face(true);
  const badge = m.word === "working" ? "" : fit(c, m.word, w * 0.5);
  const badgeW = badge ? Math.ceil(c.measureText(badge).width) + 4 : 0;
  const name = fit(c, m.name, w - 4 - (badge ? badgeW + 2 : 0));
  const nameW = Math.ceil(c.measureText(name).width) + 5;
  const tabW = Math.min(w + 2, nameW + (badge ? badgeW + 2 : 0));
  const tabH = Math.ceil(lh) + 1;
  r(c, x - 1, y - tabH - 1, tabW + 1, tabH + 1, "#26282e");
  r(c, x, y - tabH, tabW - 1, tabH, "#fbfaf6");
  write(name, x + 2, y - Math.ceil(lh * 0.28), nameW - 3, INK, true, o.hover ? t : -1);
  if (badge) {
    r(c, x + nameW, y - tabH + 1, badgeW, tabH - 2, BRAND);
    write(badge, x + nameW + 2, y - Math.ceil(lh * 0.28), badgeW - 2, INK, true);
  }
  // the posts down to the floor behind the seat, the frame and the glass
  r(c, x + 8, y + h, 2, 6, "#4a4f57");
  r(c, x + w - 10, y + h, 2, 6, "#4a4f57");
  r(c, x - 1, y - 1, w + 2, h + 2, "#26282e");
  const ix = x + 2;
  const iy = y + 2;
  const iw = w - 4;
  const ih = h - 4;
  r(c, ix, iy, iw, ih, dark ? "#1b2030" : m.mode === "alert" ? "#fde8e6" : m.mode === "dim" ? "#e6e3dc" : "#fbfaf6");
  if (m.mode === "static") {
    for (let i = 0; i < iw; i += 2)
      for (let j = 0; j < ih; j += 2) {
        const v = (Math.sin(i * 12.9898 + j * 78.233 + Math.floor(t / 70)) * 43758.5453) % 1;
        const g = 60 + Math.floor(Math.abs(v) * 180);
        r(c, ix + i, iy + j, 2, 2, `rgb(${g},${g},${g})`);
      }
  }
  const ink = dark ? "#e6e9f2" : m.mode === "alert" ? "#8a1c13" : INK;
  const soft = dark ? "#aab3cc" : "#4d4d4d";
  let row = iy + 1 + lh * 0.8;
  m.lines.forEach((ln, i) => {
    const marked = i === 1 && m.mark;
    if (marked) r(c, ix + 1, Math.round(row - s * 0.62), 3, 3, m.mark === "web" ? "#d63b3b" : BRAND);
    const lx = marked ? ix + 5 : ix + 1;
    write(ln, lx, row, ix + iw - 1 - lx, i === 1 ? ink : soft, i === 1, i === 1 && o.hover ? t : -1);
    row += lh;
  });
  // the footer: the refused share over a thin meter
  if (m.share !== null) {
    write(`${Math.round(m.share * 100)}% refused`, ix + 1, iy + ih - 3, iw - 2, soft);
    r(c, ix + 1, iy + ih - 2, iw - 2, 1, dark ? "#3a4258" : "#e2dccf");
    r(c, ix + 1, iy + ih - 2, Math.max(1, Math.round((iw - 2) * Math.min(1, m.share))), 1, BRAND);
  }
}

/** The ticker in its strip: a dark band, the line scrolling left, repeated to fill it. Returns the width of one pass,
 *  so the scroll can wrap. */
export function drawTicker(c: Ctx, line: string, scroll: number, at: { x: number; y: number; w: number; h: number }): number {
  r(c, at.x, at.y, at.w, at.h, "#141821");
  r(c, at.x, at.y, at.w, 1, BRAND);
  c.font = "bold 4.5px ui-monospace, SFMono-Regular, Menlo, monospace";
  const pass = c.measureText(line + "      ").width;
  for (let x = at.x - scroll; x < at.x + at.w; x += pass) text(c, line, x, at.y + at.h - 2.5, { size: 4.5, color: "#fffaf0", align: "left" });
  return pass;
}

/** The strip under the room (from `from` to `height`) and, beside the director's inset, who it shows and what it just
 *  did: the first line large, the rest small, each cut to the caption's width. */
export function drawStrip(c: Ctx, from: number, height: number, caption: { x: number; y: number; w: number; h: number } | null, lines: string[]) {
  r(c, 0, from, W, height - from, "#1d2433");
  if (!caption) return;
  lines.forEach((l, i) => {
    c.font = `${i === 0 ? "bold " : ""}${i === 0 ? 9 : 5.5}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    text(c, fit(c, l, caption.w - 4), caption.x + 2, caption.y + (i === 0 ? 14 : 22 + i * 9), { size: i === 0 ? 9 : 5.5, color: i === 0 ? "#fffaf0" : "#c9cfdb", align: "left", bold: i === 0 });
  });
}

/** The director's inset frame and the focus's name in its corner (the zoomed picture is copied in by the caller). */
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
