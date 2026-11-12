// Which model does our work best (owner, 2026-11-12, option 3 of the quality lanes; creatorCC queue 492): the Validator's
// daily common-data/shared-state/models-quality.json -- per model and lane over 7 days, what it wrote, the share refused,
// the judge's yes and no, second-opinion disagreements and the redo rate (null until their sources log the model) -- and
// today's lane counts from model_calls.json "lanes". Pure, for the Reports page and its test.

export type ModelLine = {
  model: string; lane: "quality" | "bulk" | string; provider: string; members: Record<string, number>;
  written: number; refused: number; refusedShare: number | null; judgeYes: number | null; judgeNo: number | null;
  disagree: number | null; redoRate: number | null;
};
export type ModelsQuality = { at: string; days: number; since: string; dataFrom: string; models: ModelLine[] };

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function parseModelsQuality(raw: unknown): ModelsQuality | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const models = (Array.isArray(o.models) ? o.models : [])
    .filter((m): m is Record<string, unknown> => !!m && typeof m === "object" && typeof (m as { model?: unknown }).model === "string")
    .map((m) => ({
      model: str(m.model), lane: str(m.lane) || "bulk", provider: str(m.provider),
      members: Object.fromEntries(Object.entries((m.members && typeof m.members === "object" ? m.members : {}) as Record<string, unknown>).filter(([, n]) => typeof n === "number")) as Record<string, number>,
      written: num(m.written) ?? 0, refused: num(m.refused) ?? 0, refusedShare: num(m.refused_share), judgeYes: num(m.judge_yes), judgeNo: num(m.judge_no),
      disagree: num(m.second_opinion_disagree), redoRate: num(m.redo_rate),
    }));
  return { at: str(o.at), days: num(o.days) ?? 7, since: str(o.since), dataFrom: str(o.data_from), models };
}

/** Today's lanes from the ledger: [{lane, model, calls}], most calls first within each lane, quality first. */
export function lanesToday(raw: unknown): { lane: string; model: string; calls: number }[] {
  const lanes = (raw && typeof raw === "object" ? (raw as { lanes?: unknown }).lanes : null) as Record<string, Record<string, unknown>> | null;
  if (!lanes || typeof lanes !== "object") return [];
  const out: { lane: string; model: string; calls: number }[] = [];
  for (const lane of ["quality", "bulk", ...Object.keys(lanes).filter((k) => k !== "quality" && k !== "bulk")]) {
    const m = lanes[lane];
    if (!m || typeof m !== "object") continue;
    for (const [model, n] of Object.entries(m)) if (typeof n === "number" && n > 0) out.push({ lane, model, calls: n });
  }
  return out.sort((a, b) => (a.lane === b.lane ? b.calls - a.calls : a.lane === "quality" ? -1 : b.lane === "quality" ? 1 : a.lane.localeCompare(b.lane)));
}

export const pct = (v: number | null) => (v === null ? "–" : `${Math.round(v * 100)}%`);
/** The judge's verdict as "yes / no (share yes)", or a dash while the judge does not log the model. */
export const judgeText = (m: ModelLine) =>
  m.judgeYes === null && m.judgeNo === null ? "–" : `${m.judgeYes ?? 0} / ${m.judgeNo ?? 0}${(m.judgeYes ?? 0) + (m.judgeNo ?? 0) ? ` (${Math.round(((m.judgeYes ?? 0) / ((m.judgeYes ?? 0) + (m.judgeNo ?? 0))) * 100)}% yes)` : ""}`;
