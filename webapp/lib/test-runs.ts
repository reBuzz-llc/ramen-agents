// Server-side only: the engine's test runs of Lead Gen against ~20 saved business sites (owner, 2026-10-06: test a
// change before it goes live). Reads common-data/testset/results/<YYYY-MM-DD-HHMM>-<commit>.json, written by the
// engine's runner. The headline is decisions right out of sites; a run with fewer sites is a partial rerun, and a run
// whose labels the Validator has not checked yet is provisional.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { BOTS_DIR } from "./bots";

const DIR = path.join(BOTS_DIR, "common-data", "testset", "results");
const FIELDS = ["email", "location", "industry", "company_size"] as const;

export type TestRun = {
  file: string;
  at: string;
  commit: string;
  sites: number;
  full: boolean;
  provisional: boolean; // labels checked < sites
  // Which answer key scored it (runner, 2026-10-07): "strict" = every site has a checked expected_lead (email + a
  // visible problem + in the target market), "lenient" = none has (email on the page decides), "mixed" = some have.
  // Null when the runner did not record it (every run before 2026-10-07).
  rule: "strict" | "lenient" | "mixed" | null;
  decision: Record<string, number>; // right, missed_lead, false_lead, no_answer
  fields: Record<string, Record<string, number>>; // per field: right, wrong, honest_blank, missed, invented, not_a_lead
  traps: { total: number; passed: number };
};

export async function testRuns(limit = 10): Promise<TestRun[]> {
  const files = (await readdir(/*turbopackIgnore: true*/ DIR).catch(() => [] as string[])).filter((f) => f.endsWith(".json")).sort().slice(-limit * 3);
  const runs: TestRun[] = [];
  for (const file of files) {
    try {
      const d = JSON.parse(await readFile(/*turbopackIgnore: true*/ path.join(DIR, file), "utf8")) as {
        at?: string;
        engine_commit?: string;
        sites?: number;
        labels_checked?: number;
        rule?: string;
        totals?: Record<string, Record<string, number>>;
        traps?: { total?: number; passed?: number };
      };
      const sites = Number(d.sites ?? 0);
      runs.push({
        file,
        at: String(d.at ?? ""),
        commit: String(d.engine_commit ?? ""),
        sites,
        full: sites >= 20,
        provisional: Number(d.labels_checked ?? 0) < sites,
        rule: d.rule === "strict" || d.rule === "lenient" || d.rule === "mixed" ? d.rule : null,
        decision: d.totals?.decision ?? {},
        fields: Object.fromEntries(FIELDS.map((f) => [f, d.totals?.[f] ?? {}])),
        traps: { total: Number(d.traps?.total ?? 0), passed: Number(d.traps?.passed ?? 0) },
      });
    } catch {
      /* a file being written */
    }
  }
  return runs.sort((a, b) => (a.at < b.at ? 1 : -1)).slice(0, limit);
}
