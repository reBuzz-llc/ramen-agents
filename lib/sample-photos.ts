// A sample's edited photos (edited pictures for the menu's popular dishes). The
// helper runs webapp/scripts/sample-photos.mjs for a draft (framing, size and light only; nothing added or removed) and
// uploads each result with the engine's key: PUT /v1/samples/<id>/photos/<name>, its bytes as the body, ?guest=1 when it is
// a guest's photo and ?dish=<name> for the dish it shows. The list lives on the sample (samples.photos) and survives
// new drafts, so a photo is uploaded once. A page uses one as "photos/<name>" ("../photos/<name>" on an extra page); the
// page check accepts that only when the name is on the sample's list. The previews carry it inline (data:, read on the
// server); at publish it goes up as one more of the slug's assets/ (the page pointed there), so the Mac's publisher is
// unchanged. A sample holding a guest's photo is never published without a person's approval.

export type SamplePhoto = { name: string; key: string; type: string; bytes: number; guest: boolean; dish: string; at: string; by: string;
  /** When someone said what this photo shows (an empty dish then means none of the lead's items). */
  dishAt?: string;
  /** The first file this photo had, kept when a grade replaced it, and the latest grade-only replacement. */
  original?: { key: string; bytes: number; type: string; at: string };
  graded?: { at: string; by: string; sha: string };
  /** An earlier Accept taken back, when, and when it had been made. */
  reopenedAt?: string; acceptedBefore?: string;
  /** What a person checked in this photo, and when (lib/sample-photo-checks.ts). A replaced photo has none. */
  checks?: string[]; checkedAt?: string;
  /** A person rejected this photo, why (optional), when, and the version whose change request carried it. */
  rejected?: boolean; rejectNote?: string; rejectedAt?: string; rejectSentOn?: number };
export type PhotoAsset = { src: string; path: string; key: string; type: string };

export const PHOTO_MAX = 5 * 1024 * 1024;
// With a gallery target of more than 20 photos, every file counts, and the photo editor makes up
// to three per photo (webp 1x, webp 2x, jpeg fallback), so 30 photos with their copies are 90 files. The bytes are capped
// as well: the editor's budgets come to about 680 KB a photo (150 + 350 + 180 KB), about 20 MB for 30; 30 MB a sample
// leaves room and keeps a sample's storage known (was 40 files of up to 5 MB, unbounded in practice at 200 MB).
export const PHOTOS_MAX = 90;
export const PHOTOS_BYTES_MAX = 30 * 1024 * 1024;
export const PHOTO_NAME = /^[a-z0-9][a-z0-9._-]{0,63}\.(webp|jpe?g|png)$/;
const EXT: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };

/** The picture's type from its first bytes (never from its name or a header), or null when it is none of webp, jpeg, png. */
export function sniff(b: Uint8Array): string | null {
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  return null;
}

/** Why this upload is refused, or "" (pure: the name, the bytes, the count already kept). */
export function uploadProblem(name: string, bytes: Uint8Array, kept: SamplePhoto[]): string {
  if (!PHOTO_NAME.test(name)) return "a photo's name is lower-case letters, digits, dots, dashes or underscores, ending .webp, .jpg, .jpeg or .png";
  if (!bytes.length) return "send the picture's bytes as the body";
  if (bytes.length > PHOTO_MAX) return `the picture is ${Math.round(bytes.length / 1024)} KB: at most ${PHOTO_MAX / 1024 / 1024} MB`;
  const type = sniff(bytes);
  if (!type) return "the body is not a webp, jpeg or png picture";
  const want = name.endsWith(".webp") ? "image/webp" : name.endsWith(".png") ? "image/png" : "image/jpeg";
  if (type !== want) return `the bytes are ${type}, but the name ends .${name.split(".").pop()}`;
  const others = kept.filter((p) => p.name !== name);
  if (others.length >= PHOTOS_MAX) return `this sample keeps ${PHOTOS_MAX} photo files: delete one first`;
  const used = others.reduce((n, p) => n + (Number(p.bytes) || 0), 0);
  if (used + bytes.length > PHOTOS_BYTES_MAX)
    return `this sample keeps ${PHOTOS_BYTES_MAX / 1024 / 1024} MB of photos (${(used / 1024 / 1024).toFixed(1)} MB now, this one ${Math.round(bytes.length / 1024)} KB): delete one first`;
  return "";
}

const REF = /(?:\.\.\/)?photos\/([a-z0-9][a-z0-9._-]{0,63}\.(?:webp|jpe?g|png))/g;

/** The photo names a page points at (photos/<name> or ../photos/<name>). */
export const photoRefs = (html: string): string[] => [...new Set([...html.matchAll(REF)].map((m) => m[1]))];

/** Is this picture address one of the sample's own photos? ("photos/<name>" on the main page, "../photos/<name>" on an
 *  extra page; a name not on the list is not.) */
export function ownPhoto(url: string, names: string[], extra: boolean): boolean {
  const m = (extra ? /^\.\.\/photos\/([^/?#]+)$/ : /^photos\/([^/?#]+)$/).exec(url);
  return !!m && names.includes(m[1]);
}

/** For a preview (never public; sandboxed, so it cannot carry the sign-in to fetch them): each photo the page uses put in
 *  as a data: picture, read on the server with `read`; one that cannot be read is left as it is (a broken picture). */
export async function inlinePhotos(html: string, photos: SamplePhoto[], read: (p: SamplePhoto) => Promise<Uint8Array | null>): Promise<string> {
  const used = photos.filter((p) => photoRefs(html).includes(p.name));
  const data = new Map<string, string>();
  await Promise.all(used.map(async (p) => {
    const b = await read(p).catch(() => null);
    if (b && sniff(b) === p.type) data.set(p.name, `data:${p.type};base64,${Buffer.from(b).toString("base64")}`);
  }));
  return html.replace(REF, (all, name: string) => data.get(name) ?? all);
}

/** The photos a published page uses, as more of its assets/ (numbered after `after`, the copied pictures' count): src as
 *  the main page writes it, path the file beside index.html. */
export function photoAssets(photos: SamplePhoto[], htmls: string[], after: number): PhotoAsset[] {
  const used = new Set(htmls.flatMap(photoRefs));
  return photos.filter((p) => used.has(p.name)).map((p, i) => ({ src: `photos/${p.name}`, path: `assets/${after + i + 1}.${EXT[p.type] ?? "jpg"}`, key: p.key, type: p.type }));
}

/** An extra page's view of them: "../photos/<name>" to "../assets/<n>". */
export const photoAssetsForPage = (a: PhotoAsset[]): PhotoAsset[] => a.map((x) => ({ ...x, src: `../${x.src}`, path: `../${x.path}` }));

/** The guest photos a person should see before approving. */
export const guestPhotos = (photos: SamplePhoto[] | null | undefined): SamplePhoto[] => (photos ?? []).filter((p) => p.guest);
