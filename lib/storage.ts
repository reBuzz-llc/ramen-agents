// Where the team's files live: Neon Object Storage, the "files" bucket in neon.ts, reached with the
// AWS-standard variables `neon deploy` writes (AWS_ENDPOINT_URL_S3, AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY).
// The browser uploads straight to the bucket with a short presigned PUT (a 25 MB PDF does not fit through a Vercel
// function), and downloads with a short presigned GET; the app only signs. Without those variables: on this Mac in
// development, and in the tests, a local folder (.data/files, or FILES_DIR) stands in, served by /api/files/local;
// in production nothing stands in, and the page says storage is not set up yet.
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export type Storage = {
  kind: "neon" | "local";
  /** Where the browser PUTs the bytes, and the headers it must send. */
  uploadUrl(key: string, contentType: string, fileId: string): Promise<{ url: string; headers: Record<string, string> }>;
  /** A short link to read it: inline (a PDF preview) or as a download under its name. */
  downloadUrl(key: string, name: string, contentType: string, inline: boolean, fileId: string): Promise<string>;
  /** The stored size, or null when nothing is there. */
  size(key: string): Promise<number | null>;
  remove(key: string): Promise<void>;
};

export const BUCKET = process.env.FILES_BUCKET?.trim() || "files";
const MINUTES = 10;

function neonConfigured() {
  return !!(process.env.AWS_ENDPOINT_URL_S3?.trim() && process.env.AWS_ACCESS_KEY_ID?.trim() && process.env.AWS_SECRET_ACCESS_KEY?.trim());
}

async function neonStorage(): Promise<Storage> {
  const { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = await import("@aws-sdk/client-s3");
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  // Neon uses path-style addressing; endpoint, region and keys come from the AWS_* variables.
  const s3 = new S3Client({ forcePathStyle: true, region: process.env.AWS_REGION?.trim() || "us-east-2" });
  const disposition = (name: string, inline: boolean) => `${inline ? "inline" : "attachment"}; filename="${name.replace(/["\\\r\n]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(name)}`;
  return {
    kind: "neon",
    async uploadUrl(key, contentType) {
      const url = await getSignedUrl(s3, new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }), { expiresIn: MINUTES * 60 });
      return { url, headers: { "Content-Type": contentType } };
    },
    async downloadUrl(key, name, contentType, inline) {
      return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key, ResponseContentDisposition: disposition(name, inline), ResponseContentType: contentType }), { expiresIn: MINUTES * 60 });
    },
    async size(key) {
      try {
        const h = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
        return typeof h.ContentLength === "number" ? h.ContentLength : null;
      } catch {
        return null;
      }
    },
    async remove(key) {
      await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
    },
  };
}

/** The stand-in folder: development on this Mac and the tests only. */
export function localDir() {
  return process.env.FILES_DIR?.trim() || path.join(process.cwd(), ".data", "files");
}
export const localPath = (key: string) => path.join(/*turbopackIgnore: true*/ localDir(), key.replace(/[^a-zA-Z0-9._/-]/g, "_").replace(/\.\.+/g, "_"));

function localStorage(): Storage {
  return {
    kind: "local",
    async uploadUrl(_key, contentType, fileId) {
      return { url: `/api/files/local/${fileId}`, headers: { "Content-Type": contentType } };
    },
    async downloadUrl(_key, _name, _type, inline, fileId) {
      return `/api/files/local/${fileId}${inline ? "?inline=1" : ""}`;
    },
    async size(key) {
      try {
        return (await stat(/*turbopackIgnore: true*/ localPath(key))).size;
      } catch {
        return null;
      }
    },
    async remove(key) {
      await rm(/*turbopackIgnore: true*/ localPath(key), { force: true });
    },
  };
}

export async function writeLocal(key: string, bytes: Uint8Array) {
  const p = localPath(key);
  await mkdir(/*turbopackIgnore: true*/ path.dirname(p), { recursive: true });
  await writeFile(/*turbopackIgnore: true*/ p, bytes);
}
export const readLocal = (key: string) => readFile(/*turbopackIgnore: true*/ localPath(key));

/** The storage in use, or null on the live app before the bucket is set up. */
export async function storage(): Promise<Storage | null> {
  if (neonConfigured()) return neonStorage();
  if (process.env.NODE_ENV !== "production" || process.env.FILES_LOCAL === "1") return localStorage();
  return null;
}

export const NOT_SET_UP = "File storage is not set up yet: the owner provisions the bucket (Neon Object Storage) and adds its four AWS_* variables to Vercel.";
