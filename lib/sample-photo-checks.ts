import { agentName } from "./agent-names";
// The photo checks on a sample's review card: the photos are checked first, with one
// Accept or Reject per photo instead of four ticks. An approved sample goes public by itself, so the person at Approve is the
// only check on what a guest's or a listing's photo shows. Accept stores the four checks; Reject marks the photo, with an optional
// note. A decision says what was looked at, not that the photo is cleared forever: replacing a photo drops it, and a new version
// only asks about photos it adds. Decisions live on the photo's own entry in samples.photos and name nobody.
// Pure, so the card, the store and the tests share it.

export const PHOTO_CHECKS = [
  { key: "people", label: "Nobody recognisable" },
  { key: "plates", label: "No plates" },
  { key: "screens", label: "No screen content" },
  { key: "print", label: "No other business's print" },
] as const;
export type PhotoCheck = (typeof PHOTO_CHECKS)[number]["key"];
export const ALL_CHECKS: PhotoCheck[] = PHOTO_CHECKS.map((c) => c.key);
/** The four rules, once, as the line above the photos. */
export const PHOTO_RULES = `Check each photo: ${PHOTO_CHECKS.map((c) => c.label.toLowerCase()).join(", ")}.`;
export const REJECT_NOTE_MAX = 200;
const REQUEST_TEXT_MAX = 1000;

/** The checks as sent, in their fixed order, or null when it is not a list of known checks. */
export function cleanChecks(v: unknown): PhotoCheck[] | null {
  if (!Array.isArray(v) || v.some((x) => !ALL_CHECKS.includes(x as PhotoCheck))) return null;
  return ALL_CHECKS.filter((k) => v.includes(k));
}

export const cleanRejectNote = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, REJECT_NOTE_MAX) : "");

/** One photo's name without its size or type: "galbi-2x.webp" and "galbi.webp" are the same photo. */
export const photoBase = (name: string) => name.replace(/\.(?:webp|jpe?g|png)$/, "").replace(/[-_@.]?(?:1x|2x)$/, "");

type Entry = { name: string; bytes: number; guest: boolean; dish: string; at?: string; dishAt?: string; checks?: string[]; checkedAt?: string;
  /** An Accept made before the full-size check was taken back: when, and when that Accept had been made. */
  reopenedAt?: string; acceptedBefore?: string;
  /** The file was replaced by a colour grade of the same picture. */
  graded?: { at: string };
  /** A person rejected this photo, why (optional), when, and the version whose change request carried it. */
  rejected?: boolean; rejectNote?: string; rejectedAt?: string; rejectSentOn?: number };
export type ReviewPhoto = { base: string; file: string;
  /** The largest stored file of this photo and when it was stored; Accept needs it opened. */
  full: string; fullAt: string;
  guest: boolean; dish: string;
  /** Someone said what this photo shows; with no dish, that it is none of the lead's dishes. */
  dishSet: boolean;
  checks: PhotoCheck[];
  rejected?: boolean; note?: string; sentOn?: number;
  /** Its earlier Accept was made before the full-size check, so it needs a new look. */
  reopened?: boolean;
  /** A colour grade of the same picture; its original is kept and can be put back. */
  graded?: boolean;
  /** The version on the web shows this photo. */
  onWeb?: boolean };

export const isChecked = (checks: readonly string[]) => ALL_CHECKS.every((k) => checks.includes(k));

/** The photos a page uses, one row per photo however many sizes it has. A check counts only when every used file carries it, so
 *  one replaced copy reopens the photo; a rejection counts while any used file carries it, so a photo with one old copy left
 *  stays rejected. Lightest file first, for the card's picture. */
export function reviewPhotos(photos: Entry[] | null | undefined, used: readonly string[]): ReviewPhoto[] {
  const on = new Set(used);
  const groups = new Map<string, Entry[]>();
  for (const p of photos ?? []) {
    if (!on.has(p.name)) continue;
    const b = photoBase(p.name);
    groups.set(b, [...(groups.get(b) ?? []), p]);
  }
  return [...groups].map(([base, files]) => {
    const light = [...files].sort((a, b) => (Number(a.bytes) || 0) - (Number(b.bytes) || 0))[0];
    const no = files.find((f) => f.rejected);
    const full = largestOf(files);
    const dish = files.find((f) => f.dish)?.dish ?? "";
    return {
      base,
      file: light.name,
      full: full.name,
      fullAt: full.at ?? "",
      guest: files.some((f) => f.guest),
      dish,
      dishSet: !!dish || files.some((f) => f.dishAt),
      checks: no ? [] : ALL_CHECKS.filter((k) => files.every((f) => (f.checks ?? []).includes(k))),
      ...(no ? { rejected: true, note: no.rejectNote ?? "", ...(no.rejectSentOn !== undefined ? { sentOn: no.rejectSentOn } : {}) } : {}),
      ...(files.some((f) => f.graded) ? { graded: true } : {}),
      ...(!no && files.some((f) => f.reopenedAt) && !files.every((f) => isChecked(f.checks ?? [])) ? { reopened: true } : {}),
    };
  });
}

/** The largest stored file of a photo, whatever its name says. */
export const largestOf = <T extends Pick<Entry, "name" | "bytes">>(files: T[]): T =>
  [...files].sort((a, b) => (Number(b.bytes) || 0) - (Number(a.bytes) || 0) || a.name.localeCompare(b.name))[0];

/** What "this person opened this photo at full size" is recorded against. A replaced file has a new time, so a new key. */
export const photoViewKey = (sampleId: string, f: Pick<Entry, "name" | "at">) => `${sampleId}:${f.name}:${f.at ?? ""}`;

/** The key of the file Accept needs opened for this photo, or null when the sample has no such photo. */
export function fullViewKey(photos: Entry[], sampleId: string, base: string): string | null {
  const files = photos.filter((p) => photoBase(p.name) === base);
  return files.length ? photoViewKey(sampleId, largestOf(files)) : null;
}

export const REOPEN_NOTE = "Accepted before the full-size check. Please open it and accept again.";

/** The photos accepted before `before` whose largest file is bigger than the one the card showed, so nobody
 *  can have seen them at real size, back to needing a look. Decisions name nobody, so what is kept is when the Accept was made. */
export function reopenUnseen<T extends Entry>(photos: T[], before: string, at: string): { photos: T[]; bases: string[] } {
  const groups = new Map<string, T[]>();
  for (const p of photos) groups.set(photoBase(p.name), [...(groups.get(photoBase(p.name)) ?? []), p]);
  const bases = [...groups].filter(([, files]) => {
    const sizes = files.map((f) => Number(f.bytes) || 0);
    return !files.some((f) => f.rejected) && files.every((f) => isChecked(f.checks ?? []) && !!f.checkedAt && f.checkedAt < before) && Math.max(...sizes) > Math.min(...sizes);
  }).map(([b]) => b);
  const chosen = new Set(bases);
  return {
    bases,
    photos: photos.map((p) => {
      if (!chosen.has(photoBase(p.name))) return p;
      const { checks: _c, checkedAt, ...rest } = p;
      void _c;
      return { ...rest, reopenedAt: at, acceptedBefore: checkedAt } as T;
    }),
  };
}

/** The longest name a photo can be marked with, from the lead's items or typed by a person. */
export const DISH_MAX = 80;

/** The names a photo can be marked with, the lead's own items in the facts: offers, then popular, then the menu. */
export function dishChoices(facts: unknown): string[] {
  const f = (facts && typeof facts === "object" ? facts : {}) as Record<string, unknown>;
  const out = new Map<string, string>();
  for (const k of ["offers", "popular", "menu"]) {
    for (const v of Array.isArray(f[k]) ? (f[k] as unknown[]) : []) {
      const raw = typeof v === "string" ? v : v && typeof v === "object" ? (v as { name?: unknown }).name : "";
      const name = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim() : "";
      if (name && name.length <= DISH_MAX && !out.has(name.toLowerCase())) out.set(name.toLowerCase(), name);
    }
  }
  return [...out.values()];
}

/** What this photo shows, on every file of it; "" is "none of these". Separate from Accept. */
export const withDish = <T extends Entry>(photos: T[], base: string, dish: string, at: string): T[] =>
  photos.map((p) => (photoBase(p.name) === base ? { ...p, dish, dishAt: at } : p));

/** Photos with no decision yet: neither accepted nor rejected. */
export const photosLeft = (list: { checks: readonly string[]; rejected?: boolean }[]) => list.filter((p) => !p.rejected && !isChecked(p.checks)).length;
export const photosRejected = (list: { rejected?: boolean }[]) => list.filter((p) => p.rejected).length;

/** The rows, each marked when the version on the web uses one of its files. */
export const markOnWeb = (rows: ReviewPhoto[], names: readonly string[]): ReviewPhoto[] => {
  const web = new Set(names.map(photoBase));
  return rows.map((p) => (web.has(p.base) ? { ...p, onWeb: true } : p));
};

/** The list with one photo's checks set on every one of its files; no checks clears them. All four also clear a rejection (the
 *  person changed their mind); fewer leave a rejected photo as it is. */
export function withChecks<T extends Entry>(photos: T[], base: string, checks: PhotoCheck[], at: string): T[] {
  return photos.map((p) => {
    if (photoBase(p.name) !== base || (p.rejected && !isChecked(checks))) return p;
    const { checks: _c, checkedAt: _a, rejected: _r, rejectNote: _n, rejectedAt: _t, rejectSentOn: _s, reopenedAt, ...rest } = p;
    void [_c, _a, _r, _n, _t, _s];
    const kept = reopenedAt && !isChecked(checks) ? { ...rest, reopenedAt } : rest; // a new Accept ends the "needs a new look"
    return (checks.length ? { ...kept, checks, checkedAt: at } : kept) as T;
  });
}

/** The list with one photo rejected on every one of its files, its checks gone. A changed note goes out with the next send-back. */
export function withRejection<T extends Entry>(photos: T[], base: string, note: string, at: string): T[] {
  return photos.map((p) => {
    if (photoBase(p.name) !== base) return p;
    const { checks: _c, checkedAt: _a, rejectNote, rejectedAt, rejectSentOn, rejected, ...rest } = p;
    void [_c, _a];
    const sent = rejected && (rejectNote ?? "") === note ? rejectSentOn : undefined;
    return { ...rest, rejected: true, ...(note ? { rejectNote: note } : {}), rejectedAt: rejected && rejectedAt ? rejectedAt : at, ...(sent !== undefined ? { rejectSentOn: sent } : {}) } as T;
  });
}

/** The list with these rejected photos marked as carried by this version's change request. */
export const withRejectSent = <T extends Entry>(photos: T[], bases: ReadonlySet<string>, version: number): T[] =>
  photos.map((p) => (p.rejected && bases.has(photoBase(p.name)) ? { ...p, rejectSentOn: version } : p));

/** What a send-back files: the rejected photos and their notes, as one change request, or several when they do not fit in one. */
export function rejectRequests(rows: ReviewPhoto[]): string[] {
  const head = "A person rejected these photos. Remove every size of each from every page and do not use them again:";
  const out: string[] = [];
  let text = head;
  for (const p of rows) {
    const line = `\n- photos/${p.file}${p.dish ? ` (${p.dish})` : ""}${p.note ? `: ${p.note}` : ""}`;
    if (text !== head && text.length + line.length > REQUEST_TEXT_MAX) {
      out.push(text);
      text = head;
    }
    text += line;
  }
  if (text !== head) out.push(text);
  return out;
}

export const photoCount = (n: number) => `${n} photo${n === 1 ? "" : "s"}`;

/** What a send-back really does, including a version that stays on the web meanwhile. */
export function sentBackMessage(n: number, liveVersion: number | null): string {
  const them = n === 1 ? "it" : "them";
  return `Sent back: the ${agentName("Site Builder")} removes ${photoCount(n)} in its next version.${liveVersion !== null ? ` Version ${liveVersion} stays on the web, with ${them}, until a version without ${them} is approved. If ${them === "it" ? "it has" : "they have"} to go now, use Take down.` : ""}`;
}
