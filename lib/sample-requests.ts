// Change requests with pictures. Up
// to three pictures a request (png, jpg, webp; the type read from the bytes, at most 5 MB each), re-encoded before they are
// kept so none carries a place, a device or a time (sharp writes no metadata unless asked; EXIF orientation is applied
// first). Kept privately in the file bucket under samples/<id>/requests/<request>/<n>.<ext>; read back only through a
// signed-in route on the Samples page and the engine's key (GET /v1/samples/<id>/requests/<rid>/pictures/<n>), never by a
// page writer: a request with a picture goes to the site helper (needsHelper).
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Db } from "./db";
import { sampleRequests } from "./db/schema";
import { PHOTO_MAX, sniff } from "./sample-photos";
import { recordRequest, requestable, REQUEST_PICTURES, SampleError, type RequestPicture, type SampleRequest } from "./samples";
import { readLocal, storage } from "./storage";

const EXT: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };
export type Encode = (bytes: Uint8Array, type: string) => Promise<Uint8Array>;
export type PictureStore = { put: (key: string, bytes: Uint8Array, type: string) => Promise<void> };

/** Re-encode a picture in its own format with no metadata (sharp, already installed with Next). */
export const reencode: Encode = async (bytes, type) => {
  const sharp = (await import("sharp")).default;
  const img = sharp(Buffer.from(bytes), { failOn: "error" }).rotate();
  const out = type === "image/png" ? img.png() : type === "image/webp" ? img.webp({ quality: 85 }) : img.jpeg({ quality: 85, mozjpeg: true });
  return new Uint8Array(await out.toBuffer());
};

/** Why these pictures are refused, or "" (pure: their count, sizes and types read from the bytes). */
export function picturesProblem(pics: Uint8Array[]): string {
  if (pics.length > REQUEST_PICTURES) return `a request takes at most ${REQUEST_PICTURES} pictures`;
  for (const [i, b] of pics.entries()) {
    if (!b.length) return `picture ${i + 1} is empty`;
    if (b.length > PHOTO_MAX) return `picture ${i + 1} is ${Math.round(b.length / 1024)} KB: at most ${PHOTO_MAX / 1024 / 1024} MB`;
    if (!sniff(b)) return `picture ${i + 1} is not a png, jpg or webp picture`;
  }
  return "";
}

/** A person's request with its pictures: checked, re-encoded, stored, then recorded. */
export async function addSampleRequest(d: Db, tenantId: string, sampleId: string, r: { text: string; byName: string; byUser?: string | null; pictures?: Uint8Array[] },
  store?: PictureStore | null, encode: Encode = reencode): Promise<{ request: SampleRequest }> {
  const pics = r.pictures ?? [];
  const problem = picturesProblem(pics);
  if (problem) throw new SampleError(400, problem);
  // the text and the sample are checked before any picture is stored
  await requestable(d, tenantId, sampleId, r.text);
  const id = randomUUID();
  const kept: RequestPicture[] = [];
  if (pics.length) {
    const st = store === undefined ? await storage().then((s) => (s ? { put: (k: string, b: Uint8Array, t: string) => s.put(k, b, t) } : null)) : store;
    if (!st) throw new SampleError(503, "file storage is not set up, so pictures cannot be kept: send the request without them");
    for (const [i, raw] of pics.entries()) {
      const type = sniff(raw)!;
      let bytes: Uint8Array;
      try {
        bytes = await encode(raw, type);
      } catch {
        throw new SampleError(400, `picture ${i + 1} could not be read as a picture`);
      }
      const key = `samples/${sampleId}/requests/${id}/${i + 1}.${EXT[type]}`;
      await st.put(key, bytes, type);
      kept.push({ n: i + 1, key, type, bytes: bytes.length });
    }
  }
  try {
    const { request } = await recordRequest(d, tenantId, sampleId, { id, text: r.text, byName: r.byName, byUser: r.byUser, pictures: kept });
    return { request };
  } catch (err) {
    // the sample changed between the check and the record (taken down meanwhile): its pictures are not left behind
    const st = await storage().catch(() => null);
    for (const p of kept) await st?.remove(p.key).catch(() => undefined);
    throw err;
  }
}

/** One request's picture n: its bytes and type, or null. */
export async function requestPicture(d: Db, tenantId: string, sampleId: string, requestId: string, n: number,
  read?: (key: string, type: string) => Promise<Uint8Array | null>): Promise<{ bytes: Uint8Array; type: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || !Number.isInteger(n)) return null;
  const [r] = await d.select({ pictures: sampleRequests.pictures }).from(sampleRequests)
    .where(and(eq(sampleRequests.tenantId, tenantId), eq(sampleRequests.sampleId, sampleId), eq(sampleRequests.id, requestId)));
  const p = (r?.pictures ?? []).find((x) => x.n === n);
  if (!p) return null;
  const get = read ?? (async (key: string, type: string) => {
    const st = await storage();
    if (!st) return null;
    if (st.kind === "local") return new Uint8Array(await readLocal(key));
    const res = await fetch(await st.downloadUrl(key, key.split("/").pop() ?? "picture", type, true, ""), { signal: AbortSignal.timeout(15000) });
    return res.ok ? new Uint8Array(await res.arrayBuffer()) : null;
  });
  const bytes = await get(p.key, p.type).catch(() => null);
  return bytes ? { bytes, type: p.type } : null;
}

/** The engine's view of a request (the shape agreed with the Validator). `byPerson` is true only for a request filed
 *  through a signed-in session; `by` is a display name that any key can set, and the person's id is never sent. */
export const requestView = (r: SampleRequest) => ({
  id: r.id, text: r.text, by: r.byName, byPerson: !!r.byUser, at: r.at.toISOString(), madeOnVersion: r.madeOnVersion, status: r.status,
  answeredVersion: r.answeredVersion, answeredAt: r.answeredAt?.toISOString() ?? null,
  pictures: (r.pictures ?? []).map((p) => ({ n: p.n, type: p.type, bytes: p.bytes })), needsHelper: (r.pictures ?? []).length > 0,
});
