// The Work plan → Checks page's rules, pure so
// the tests read them: how an action's verdict is counted, the plain-language label of a refusal, the change markers
// (engine commits, bot restarts, the shared change log) and The CEO's tasks done on the team portal.

// ---- verdicts -------------------------------------------------------------------------------------------------------
/** allowed; refused (the rate's numerator); fence (the safety rules working: counted apart, never against the target);
 *  held (waiting for someone, not refused); failed (the action ran and did not work, e.g. a row already drafted);
 *  closed (a site closed for the day: a captcha or no text). */
export type Kind = "allowed" | "refused" | "fence" | "held" | "failed" | "closed";
export const KINDS: Kind[] = ["refused", "failed", "held", "closed", "fence", "allowed"];

// "that site asks bots not to read it" is the robots rule as the engine words it since 204 (Lead Gen's top reason)
export const FENCE = /personal mailbox|does not appear on any page|MG03|robots\.txt|asks bots not to read|never guess|LD0[12]|LD1[458]|LD20|actually opened|actually seen|own site/i;
const CLOSED = /captcha or no text|whole site is closed|site (?:is )?closed (?:today|for the day)|closed for today/i;

export function kindOf(verdict: string): Kind {
  const v = verdict.trim();
  if (!v || v === "allowed") return "allowed";
  if (/^held\b/i.test(v)) return "held";
  if (/^failed\b/i.test(v)) return "failed";
  if (FENCE.test(v)) return "fence";
  if (CLOSED.test(v)) return "closed";
  return "refused";
}

// ---- plain-language reasons ---------------------------------------------------------------------------------------------
const LABELS: [RegExp, string][] = [
  [/already has a (?:WhatsApp )?draft|a skip never replaces a draft/i, "Tried a row that's already drafted"],
  [/you searched that today|already searched|searches were refused/i, "Searched the same thing again"],
  [/refused or done already today|blocked for this episode|blocked until tomorrow/i, "Tried again what was refused or done today"],
  [/update_lead takes the exact business name/i, "Named a lead that isn't on the board"],
  [/question was answered on/i, "Asked a question already answered"],
  [/questions were already refused|already asked .* still open/i, "Asked again while waiting"],
  [/already fixed \d+ leads this episode/i, "Reached the episode's fix limit"],
  [/is an edit, not research|list item is an edit/i, "Handed in an edit as research"],
  [/packages page shows old prices/i, "Waiting for the owner to republish prices"],
  [/not reviewed: .* not the owner's price/i, "A package price that isn't the owner's"],
  [/note exists|already saved a note titled|the note you already have/i, "Wrote a note that already exists"],
  [/already has (?!a (?:WhatsApp )?draft)[A-Z][\w ]{1,30}$|already has (?:Location|Industry|Phone|Contact|Package|Pain point|Email|WhatsApp)\b/i, "Filled a cell that's already filled"],
  [/is already in the report/i, "Reported something already in the report"],
  [/a lead needs a way to reach the business/i, "Listed a lead with no email or WhatsApp"],
  [/'s job: propose its goal/i, "Tried another agent's job"],
  [/episode budget used up/i, "Ran out of the episode's budget"],
  [/tasks not started/i, "Too many tasks already waiting"],
  [/plans are done for today|new plans were refused|already have this plan|a plan is done when|no step names a write/i, "Planned instead of doing"],
  [/read four parts|read this site enough|without noting anything|since your last write|move on: \d+ pages/i, "Read too long without writing"],
  [/review message today/i, "Sent a second review message today"],
  [/could not be reached|ConnectError|timed out|HTTP 5\d\d/i, "A service didn't answer"],
  [/asks bots not to read/i, "The site asks bots not to read it"],
  [/captcha or no text|site is closed/i, "Site closed today (captcha or no text)"],
  [/sources must be|every source must be a page|actually seen|actually opened/i, "Cited a page it never opened"],
  [/personal mailbox/i, "A personal mailbox, not the business's"],
];

/** The reason in plain words: a known one's label, a Validator rule by its code, else its first clause tidied. */
export function reasonLabel(verdict: string): string {
  const v = verdict.replace(/^(rejected|failed|held):\s*/i, "");
  for (const [re, label] of LABELS) if (re.test(v)) return label;
  const rule = v.match(/Validator rules?:\s*([A-Z]{2,4}\d*)/);
  if (rule) return `Broke the Validator's rule ${rule[1]}`;
  const first = v.slice(0, 80).replace(/'[^']*'?/g, "'…'").replace(/\d+/g, "N").split(/[;:,(]| — | -- /)[0].trim();
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "No reason given";
}

export type Case = { ts: string; business: string; tried: string };

// ---- change markers -------------------------------------------------------------------------------------------------
export type Marker = { at: string; by: string; bots: string[]; kind: "engine" | "restart" | "note"; what: string };

/** `git log --pretty=%cI|%h|%s` of the engine: one marker per commit, for every bot, at its local time. */
export function engineMarkers(stdout: string): Marker[] {
  const out: Marker[] = [];
  for (const line of stdout.split("\n")) {
    const [iso, hash, ...rest] = line.split("|");
    if (!iso || !hash || !/^\d{4}-\d\d-\d\dT/.test(iso)) continue;
    out.push({ at: iso.slice(0, 19), by: "engine", bots: ["*"], kind: "engine", what: `${hash} ${rest.join("|")}`.slice(0, 240) });
  }
  return out;
}

/** Each running bot's last start in the tick report (fleet[].started), as a restart marker for that bot. */
export function restartMarkers(tick: unknown): Marker[] {
  const fleet = (tick as { fleet?: { slug?: unknown; name?: unknown; started?: unknown }[] } | null)?.fleet;
  if (!Array.isArray(fleet)) return [];
  return fleet
    .filter((f) => typeof f.slug === "string" && typeof f.started === "string" && /^\d{4}-\d\d-\d\dT/.test(f.started))
    .map((f) => ({ at: String(f.started).slice(0, 19), by: "restart", bots: [String(f.slug)], kind: "restart" as const, what: `${String(f.name ?? f.slug)} restarted` }));
}

// ---- The CEO's tasks done on the portal ------------------------------------------------------------------------------------
export type PortalTask = { id: string; status?: string | null; updated_at?: string | null };
export type TaskStep = { column: string; new: unknown; actor: { kind: string }; at: string; outcome?: string };

/** When a person moved the task to Done (the newest such step in its history), else null: a bot's Done is not the team's. */
export function doneByPerson(history: TaskStep[]): string | null {
  const steps = history.filter((h) => h.column === "status" && h.new === "Done" && h.actor?.kind === "person" && (h.outcome ?? "applied") === "applied");
  return steps.map((h) => h.at).sort().at(-1) ?? null;
}

/** The week index (0 = the last seven days, up to 3) of a time, or -1. */
export function weekIndex(iso: string, now: number): number {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t > now) return -1;
  const i = Math.floor((now - t) / (7 * 86400e3));
  return i < 4 ? i : -1;
}

/** Statuses that are not open work. */
export const CLOSED_TASK = new Set(["Done", "Dublicate", "Duplicate", "Archived"]);

// ---- the verdict line -------------------------------------------------------------------------------------
export const REFUSAL_TARGET = 20;
type Counts = { allowed: number; refused: number };
/** refused / (accepted + refused) in whole percent, or null without either. */
export const rateOf = (d: Counts): number | null => (d.allowed + d.refused ? Math.round((100 * d.refused) / (d.allowed + d.refused)) : null);
/** "↑ 3" / "↓ 3" / "=" against last week, in points; null when either week has nothing. */
export function deltaOf(now: Counts, prev: Counts): { arrow: "↑" | "↓" | "="; points: number } | null {
  const a = rateOf(now);
  const b = rateOf(prev);
  if (a === null || b === null) return null;
  return { arrow: a > b ? "↑" : a < b ? "↓" : "=", points: Math.abs(a - b) };
}

/** The page's one line: the family's rate this week against last week, how many agents are under target, and the worst. */
export function verdictOf(rows: { name: string; week: Counts; prevWeek: Counts }[]): { text: string; worst: { name: string; rate: number } | null } {
  const sum = (k: "week" | "prevWeek") => rows.reduce((t, r) => ({ allowed: t.allowed + r[k].allowed, refused: t.refused + r[k].refused }), { allowed: 0, refused: 0 });
  const now = rateOf(sum("week"));
  if (now === null) return { text: "No actions in the last seven days.", worst: null };
  const d = deltaOf(sum("week"), sum("prevWeek"));
  const rated = rows.map((r) => ({ name: r.name, rate: rateOf(r.week) })).filter((r): r is { name: string; rate: number } => r.rate !== null);
  const under = rated.filter((r) => r.rate <= REFUSAL_TARGET).length;
  const worst = rated.sort((a, b) => b.rate - a.rate)[0] ?? null;
  const vs = d ? (d.arrow === "=" ? " (same as last week)" : ` (${d.arrow} ${d.points} pts vs last week)`) : "";
  return { text: `The family refused ${now}% of its actions this week${vs}; ${under} of ${rated.length} agents under the ${REFUSAL_TARGET}% target.`, worst: worst && worst.rate > REFUSAL_TARGET ? worst : null };
}
