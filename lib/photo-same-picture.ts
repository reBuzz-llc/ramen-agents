// Applied directly to a live site's photo files, without a request: a photo on a live page may
// be replaced only by the same picture with its tone and colour changed. Three checks, measured on 24 real sample photos:
//  1. identical pixel size;
//  2. one smooth colour curve, fitted across the whole picture, must explain every patch of the new file. A grade is such a curve; a
//     crop, a mirror, another photo or an added object is not. The worst 8 px patch (at 256 px) may be off by at most MAX_PATCH of 255;
//  3. no patch may lose its detail against the rest of the picture (a blurred-out face would).
// On those photos it accepted every ordinary grade and refused every crop (0.5% and up), mirror, other photo and added object (3% of
// the width and up). What it can miss: an object under about 3% of the width or close in colour to what it covers, and a blur over a
// patch with almost no detail (5 of 72 tried). A very heavy grade can be refused, which is the safe way to be wrong.

export const MAX_PATCH = 30;
export const MIN_DETAIL = 0.35;
const LONG = 256;
const CELL = 8;
const DETAIL_LONG = 512;
const DETAIL_CELL = 16;
const TERMS = 20;

export type SameCheck = { same: boolean; reason: string; patch: number; detail: number };

const terms = (r: number, g: number, b: number) => [1, r, g, b, r * r, g * g, b * b, r * g, r * b, g * b, r * r * r, g * g * g, b * b * b, r * r * g, r * r * b, g * g * r, g * g * b, b * b * r, b * b * g, r * g * b];

function solve(matrix: Float64Array[], target: Float64Array): number[] {
  const n = target.length;
  const m = matrix.map((row, i) => [...row, target[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let i = c + 1; i < n; i++) if (Math.abs(m[i][c]) > Math.abs(m[p][c])) p = i;
    [m[c], m[p]] = [m[p], m[c]];
    const d = m[c][c] || 1e-9;
    for (let i = c + 1; i < n; i++) {
      const f = m[i][c] / d;
      if (f) for (let j = c; j <= n; j++) m[i][j] -= f * m[c][j];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = m[i][n];
    for (let j = i + 1; j < n; j++) s -= m[i][j] * x[j];
    x[i] = s / (m[i][i] || 1e-9);
  }
  return x;
}

/** The worst patch the best single colour curve from `a` to `b` leaves unexplained. Pixels it cannot fit are left out of the next
 *  fit, so an edited patch does not bend the curve toward itself. */
function worstPatch(a: Uint8Array, b: Uint8Array, w: number, h: number): number {
  const n = w * h;
  const err = new Float32Array(n);
  let use = new Uint8Array(n).fill(1);
  for (let round = 0; round < 3; round++) {
    const ata = Array.from({ length: TERMS }, () => new Float64Array(TERMS));
    const atb = [new Float64Array(TERMS), new Float64Array(TERMS), new Float64Array(TERMS)];
    for (let p = 0; p < n; p += 2) {
      if (!use[p]) continue;
      const i = p * 3;
      const t = terms(a[i] / 255, a[i + 1] / 255, a[i + 2] / 255);
      for (let u = 0; u < TERMS; u++) {
        for (let v = u; v < TERMS; v++) ata[u][v] += t[u] * t[v];
        for (let c = 0; c < 3; c++) atb[c][u] += t[u] * b[i + c];
      }
    }
    for (let u = 0; u < TERMS; u++) {
      ata[u][u] += 1e-6;
      for (let v = 0; v < u; v++) ata[u][v] = ata[v][u];
    }
    const curve = [0, 1, 2].map((c) => solve(ata, atb[c]));
    for (let p = 0; p < n; p++) {
      const i = p * 3;
      const t = terms(a[i] / 255, a[i + 1] / 255, a[i + 2] / 255);
      let e = 0;
      for (let c = 0; c < 3; c++) {
        let f = 0;
        for (let u = 0; u < TERMS; u++) f += curve[c][u] * t[u];
        e = Math.max(e, Math.abs(Math.max(0, Math.min(255, f)) - b[i + c]));
      }
      err[p] = e;
    }
    const sorted = Float32Array.from(err).sort();
    const cut = Math.max(12, sorted[Math.floor(n * 0.9)] * 2);
    use = Uint8Array.from(err, (e) => (e <= cut ? 1 : 0));
  }
  let worst = 0;
  for (let y = 0; y + CELL <= h; y += CELL / 2) {
    for (let x = 0; x + CELL <= w; x += CELL / 2) {
      let s = 0;
      for (let j = 0; j < CELL; j++) for (let i = 0; i < CELL; i++) s += err[(y + j) * w + x + i];
      worst = Math.max(worst, s / (CELL * CELL));
    }
  }
  return worst;
}

function energy(g: Uint8Array, w: number, h: number): number[] {
  const out: number[] = [];
  for (let y = 0; y + DETAIL_CELL < h; y += DETAIL_CELL / 2) {
    for (let x = 0; x + DETAIL_CELL < w; x += DETAIL_CELL / 2) {
      let e = 0;
      for (let j = 0; j < DETAIL_CELL; j++) {
        for (let i = 0; i < DETAIL_CELL; i++) {
          const p = (y + j) * w + x + i;
          e += Math.abs(g[p + 1] - g[p]) + Math.abs(g[p + w] - g[p]);
        }
      }
      out.push(e / (DETAIL_CELL * DETAIL_CELL));
    }
  }
  return out;
}

/** The patch that lost the most detail, against how much the picture as a whole kept (1: none lost more than the rest). */
function detailKept(a: Uint8Array, b: Uint8Array, w: number, h: number): number {
  const ea = energy(a, w, h);
  const eb = energy(b, w, h);
  const ratios: number[] = [];
  for (let i = 0; i < ea.length; i++) if (ea[i] > 6) ratios.push(eb[i] / ea[i]);
  if (!ratios.length) return 1;
  ratios.sort((x, y) => x - y);
  return ratios[0] / (ratios[Math.floor(ratios.length / 2)] || 1);
}

const shown = (m: { orientation?: number; width?: number; height?: number }) => ((m.orientation ?? 1) >= 5 ? { w: m.height ?? 0, h: m.width ?? 0 } : { w: m.width ?? 0, h: m.height ?? 0 });
const scaled = (w: number, h: number, long: number) => (w >= h ? { w: long, h: Math.max(1, Math.round((long * h) / w)) } : { w: Math.max(1, Math.round((long * w) / h)), h: long });
const raw = async (bytes: Uint8Array, w: number, h: number, grey: boolean) => {
  const sharp = (await import("sharp")).default;
  const p = sharp(bytes).rotate().removeAlpha().resize(w, h, { fit: "fill", kernel: "cubic" });
  const out = await (grey ? p.greyscale() : p).raw().toBuffer();
  return new Uint8Array(out.buffer, out.byteOffset, out.length);
};

/** Is `after` the picture `before`, with only its tone and colour changed? Anything unreadable is "no". */
export async function samePicture(before: Uint8Array, after: Uint8Array): Promise<SameCheck> {
  const no = (reason: string, patch = 0, detail = 0): SameCheck => ({ same: false, reason, patch, detail });
  try {
    const sharp = (await import("sharp")).default;
    const [ma, mb] = await Promise.all([sharp(before).metadata(), sharp(after).metadata()]);
    const a = shown(ma);
    const b = shown(mb);
    if (!a.w || !a.h || !b.w || !b.h) return no("the picture could not be read");
    if (a.w !== b.w || a.h !== b.h) return no(`its size is ${b.w}x${b.h}, the stored one is ${a.w}x${a.h}`);
    const s = scaled(a.w, a.h, LONG);
    const patch = worstPatch(await raw(before, s.w, s.h, false), await raw(after, s.w, s.h, false), s.w, s.h);
    if (patch > MAX_PATCH) return no("part of the picture changed, not only its tone and colour", patch);
    const d = scaled(a.w, a.h, DETAIL_LONG);
    const detail = detailKept(await raw(before, d.w, d.h, true), await raw(after, d.w, d.h, true), d.w, d.h);
    if (detail < MIN_DETAIL) return no("part of the picture lost its detail", patch, detail);
    return { same: true, reason: "", patch, detail };
  } catch {
    return no("the picture could not be read");
  }
}
