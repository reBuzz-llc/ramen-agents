// Lead Gen's candidate list files (scripts/candidates-feed.py): candidates-<market>-YYYY-MM-DD.md, and since valiCC
// deeae3c a second, midday batch candidates-<market>-YYYY-MM-DDT12.md (creatorCC queue 444). Self-contained, so the
// test runs with Node's own runner.

export type CandidateFile = { file: string; market: string; date: string; midday: boolean };

const NAME = /^candidates-(.+)-(\d{4}-\d{2}-\d{2})(T12)?\.md$/;

/** The file's market, date and batch, or null for any other name. */
export function candidateFile(file: string): CandidateFile | null {
  const m = NAME.exec(file);
  return m ? { file, market: m[1], date: m[2], midday: m[3] === "T12" } : null;
}

/** The lists of the last `days` days that have one (both batches of a day count as one day), oldest first, the
 *  morning batch before the midday one. */
export function recentFiles(names: string[], days: number): CandidateFile[] {
  const all = names
    .map(candidateFile)
    .filter((f): f is CandidateFile => f !== null)
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.midday !== b.midday ? (a.midday ? 1 : -1) : a.market < b.market ? -1 : 1));
  const dates = [...new Set(all.map((f) => f.date))].slice(-days);
  return all.filter((f) => dates.includes(f.date));
}

/** "11-11" or "11-11 midday". */
export const batchLabel = (f: CandidateFile) => `${f.date.slice(5)}${f.midday ? " midday" : ""}`;
