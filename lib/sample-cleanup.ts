// The samples' file clean-up. Peek's file bucket is
// Supabase's free 1 GB for everything, so three rules free what no one will look at again. Rows and text always stay; only
// files go, and each row's list of them is updated to match:
//   (b) older versions' Approve copies: removed 14 days after a newer version was approved; the approved version's and
//       the one before it always stay.
//   (c) a rejected or taken-down sample untouched for 30 days (and off the web): its photos, all its copies and its
//       change requests' pictures. The Samples list says so in the 7 days before.
//   (d) an uploaded photo that neither the current version nor the approved one uses, and that no page version used in
//       the last 30 days (nor was uploaded in them).
// Never removed, whatever a rule says: a file the current version (a waiting draft, or what is up) or the approved version
// uses -- checked again for every file just before it goes. Shells have their own 7-day sweep (lib/samples.ts).
// A dry run lists what a sweep would remove; a sweep logs counts and megabytes only.
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "./db";
import { sampleRequests, sampleVersions, samples } from "./db/schema";
import type { Asset } from "./sample-page";
import { photoRefs, type SamplePhoto } from "./sample-photos";
import { storage } from "./storage";

export const COPIES_DAYS = 14;
export const DEAD_DAYS = 30;
export const UNUSED_DAYS = 30;
export const WARN_DAYS = 7;
const DAY = 86_400_000;
export type Rule = "old-copies" | "dead-sample" | "unused-photo";
export type Doomed = { rule: Rule; sampleId: string; key: string; bytes: number };
export type CleanupResult = { dry: boolean; files: number; mb: number; byRule: Record<Rule, { files: number; mb: number }>; samples: number; items?: Doomed[] };

const joined = (html: string, pages: { html: string }[] | null | undefined) => [html, ...(pages ?? []).map((p) => p.html)].join("\n");
const mb = (b: number) => Math.round((b / 1024 / 1024) * 10) / 10;

/** When a rejected or taken-down sample's files go: 30 days after it last changed (pure; the Samples list's warning). */
export const deadFilesGoAt = (updatedAt: string | Date) => new Date(new Date(updatedAt).getTime() + DEAD_DAYS * DAY);

type Row = typeof samples.$inferSelect;
type Version = { sampleId: string; version: number; html: string; pages: { html: string }[] | null; assets: Asset[] | null; madeAt: Date };

/** The files in use on a sample right now: the current version's photos and copies, and the approved version's. */
function inUse(s: Row, versions: Version[]): Set<string> {
  const keys = new Set<string>();
  const photos = (s.photos ?? []) as SamplePhoto[];
  const byName = new Map(photos.map((p) => [p.name, p.key]));
  const originals = new Map(photos.map((p) => [p.name, p.original?.key])); // a graded photo's original stays with it
  const markPage = (html: string, assets: Asset[] | null | undefined) => {
    for (const n of photoRefs(html)) {
      if (byName.has(n)) keys.add(byName.get(n)!);
      if (originals.get(n)) keys.add(originals.get(n)!);
    }
    for (const a of assets ?? []) keys.add(a.key);
  };
  if (s.status !== "rejected" && s.status !== "taken_down") markPage(joined(s.html, s.pages), s.assets as Asset[]);
  if (s.approvedVersion !== null && s.status !== "rejected" && s.status !== "taken_down") {
    const v = s.approvedVersion === s.version ? null : versions.find((x) => x.version === s.approvedVersion);
    if (v) markPage(joined(v.html, v.pages), v.assets);
  }
  return keys;
}

/** What the three rules would remove now (pure over the rows). */
export function plan(rows: Row[], versionsOf: Map<string, Version[]>, picturesOf: Map<string, { key: string; bytes: number }[]>, now: Date): Doomed[] {
  const out: Doomed[] = [];
  for (const s of rows) {
    if (s.status === "shell") continue;
    const versions = versionsOf.get(s.id) ?? [];
    const keep = inUse(s, versions);
    const add = (rule: Rule, key: string, bytes: unknown) => {
      if (!key || keep.has(key) || out.some((x) => x.key === key)) return;
      out.push({ rule, sampleId: s.id, key, bytes: Number(bytes) || 0 });
    };
    const dead = (s.status === "rejected" || s.status === "taken_down") && !s.url && deadFilesGoAt(s.updatedAt).getTime() <= now.getTime();
    if (dead) {
      for (const p of (s.photos ?? []) as SamplePhoto[]) {
        add("dead-sample", p.key, p.bytes);
        if (p.original) add("dead-sample", p.original.key, p.original.bytes);
      }
      for (const a of (s.assets ?? []) as Asset[]) add("dead-sample", a.key, a.bytes);
      for (const v of versions) for (const a of v.assets ?? []) add("dead-sample", a.key, a.bytes);
      for (const q of picturesOf.get(s.id) ?? []) add("dead-sample", q.key, q.bytes);
      continue;
    }
    if (s.status === "rejected" || s.status === "taken_down") continue;
    // (b) the versions whose copies always stay: the approved one and the approved one before it
    const approvedBefore = versions.filter((v) => (v.assets ?? []).length && s.approvedVersion !== null && v.version < s.approvedVersion).sort((a, b) => b.version - a.version)[0];
    const stays = new Set<number>([s.approvedVersion ?? -1, approvedBefore?.version ?? -1]);
    // when a newer version than n was approved: its copies' time, else the sample's last review while a newer one is approved
    const newerApprovedAt = (n: number): number | null => {
      const times = versions.filter((v) => v.version > n).flatMap((v) => (v.assets ?? []).map((a) => (a.at ? new Date(a.at).getTime() : NaN))).filter((t) => !Number.isNaN(t));
      for (const a of (s.assets ?? []) as Asset[]) if (s.version > n && a.at) times.push(new Date(a.at).getTime());
      if (times.length) return Math.min(...times);
      return s.approvedVersion !== null && s.approvedVersion > n && s.reviewedAt ? s.reviewedAt.getTime() : null;
    };
    for (const v of versions) {
      if (stays.has(v.version) || !(v.assets ?? []).length) continue;
      const at = newerApprovedAt(v.version);
      if (at !== null && now.getTime() - at >= COPIES_DAYS * DAY) for (const a of v.assets ?? []) add("old-copies", a.key, a.bytes);
    }
    // (d) photos nothing up or waiting uses, unused by every version for 30 days
    for (const p of (s.photos ?? []) as SamplePhoto[]) {
      if (keep.has(p.key)) continue;
      const lastUse = Math.max(new Date(p.at || 0).getTime() || 0, ...versions.filter((v) => photoRefs(joined(v.html, v.pages)).includes(p.name)).map((v) => v.madeAt.getTime()));
      if (now.getTime() - lastUse >= UNUSED_DAYS * DAY) {
        add("unused-photo", p.key, p.bytes);
        if (p.original) add("unused-photo", p.original.key, p.original.bytes);
      }
    }
  }
  return out;
}

async function load(d: Db, tenantId: string) {
  const rows = await d.select().from(samples).where(eq(samples.tenantId, tenantId));
  const ids = rows.map((r) => r.id);
  const vs = ids.length
    ? await d.select({ sampleId: sampleVersions.sampleId, version: sampleVersions.version, html: sampleVersions.html, pages: sampleVersions.pages, assets: sampleVersions.assets, madeAt: sampleVersions.madeAt })
      .from(sampleVersions).where(and(eq(sampleVersions.tenantId, tenantId), inArray(sampleVersions.sampleId, ids)))
    : [];
  const qs = ids.length ? await d.select({ sampleId: sampleRequests.sampleId, pictures: sampleRequests.pictures }).from(sampleRequests).where(and(eq(sampleRequests.tenantId, tenantId), inArray(sampleRequests.sampleId, ids))) : [];
  const versionsOf = new Map<string, Version[]>();
  for (const v of vs) versionsOf.set(v.sampleId, [...(versionsOf.get(v.sampleId) ?? []), v as Version]);
  const picturesOf = new Map<string, { key: string; bytes: number }[]>();
  for (const q of qs) picturesOf.set(q.sampleId, [...(picturesOf.get(q.sampleId) ?? []), ...(q.pictures ?? [])]);
  return { rows, versionsOf, picturesOf };
}

/** Run the clean-up: `dry` (the default) lists what would go and changes nothing; otherwise each file is removed (after a
 *  last in-use check on the row as it is then) and its row's list updated. Counts and megabytes only, in the result. */
export async function runCleanup(d: Db, tenantId: string, opts: { dry?: boolean; now?: Date; remove?: ((key: string) => Promise<void>) | null } = {}): Promise<CleanupResult> {
  const dry = opts.dry !== false;
  const now = opts.now ?? new Date();
  const { rows, versionsOf, picturesOf } = await load(d, tenantId);
  let doomed = plan(rows, versionsOf, picturesOf, now);
  if (!dry && doomed.length) {
    const rm = opts.remove === undefined ? await storage().then((st) => (st ? (k: string) => st.remove(k) : null)) : opts.remove;
    if (!rm) throw new Error("file storage is not set up: nothing removed");
    const done: Doomed[] = [];
    for (const id of [...new Set(doomed.map((x) => x.sampleId))]) {
      await d.transaction(async (tx) => {
        const t = tx as unknown as Db;
        // the row as it is now, under its lock: a version that arrived since keeps what it uses
        const [s] = await t.select().from(samples).where(eq(samples.id, id)).for("update");
        if (!s) return;
        const fresh = await t.select({ sampleId: sampleVersions.sampleId, version: sampleVersions.version, html: sampleVersions.html, pages: sampleVersions.pages, assets: sampleVersions.assets, madeAt: sampleVersions.madeAt })
          .from(sampleVersions).where(eq(sampleVersions.sampleId, id));
        const keep = inUse(s, fresh as Version[]);
        const mine = doomed.filter((x) => x.sampleId === id && !keep.has(x.key));
        if (!mine.length) return;
        const gone = new Set(mine.map((x) => x.key));
        for (const k of gone) await rm(k);
        const left = <T extends { key: string }>(list: T[] | null | undefined) => (list ?? []).filter((x) => !gone.has(x.key));
        await t.update(samples).set({ photos: left(s.photos as SamplePhoto[]), assets: left(s.assets as Asset[]) }).where(eq(samples.id, id));
        for (const v of fresh) if ((v.assets ?? []).some((a) => gone.has(a.key))) await t.update(sampleVersions).set({ assets: left(v.assets) }).where(and(eq(sampleVersions.sampleId, id), eq(sampleVersions.version, v.version)));
        const asks = await t.select({ id: sampleRequests.id, pictures: sampleRequests.pictures }).from(sampleRequests).where(eq(sampleRequests.sampleId, id));
        for (const q of asks) if ((q.pictures ?? []).some((p) => gone.has(p.key))) await t.update(sampleRequests).set({ pictures: left(q.pictures) }).where(eq(sampleRequests.id, q.id));
        done.push(...mine);
      });
    }
    doomed = done;
  }
  const byRule = { "old-copies": { files: 0, mb: 0 }, "dead-sample": { files: 0, mb: 0 }, "unused-photo": { files: 0, mb: 0 } } as CleanupResult["byRule"];
  const bytes = { "old-copies": 0, "dead-sample": 0, "unused-photo": 0 } as Record<Rule, number>;
  for (const x of doomed) {
    byRule[x.rule].files++;
    bytes[x.rule] += x.bytes;
  }
  for (const r of Object.keys(byRule) as Rule[]) byRule[r].mb = mb(bytes[r]);
  const total = doomed.reduce((n, x) => n + x.bytes, 0);
  return { dry, files: doomed.length, mb: mb(total), byRule, samples: new Set(doomed.map((x) => x.sampleId)).size, ...(dry ? { items: doomed } : {}) };
}
