// The shared ledger's health line for a provider (model_calls.json "health"), for Key providers -> All keys. Pure.
export type Health = { last_ok?: string; last_fail?: string; first_fail?: string; last_reason?: string; spent?: string };
/** The ledger's word on a provider, or null when it answers: "limited" while its allowance is marked spent for today or
 *  this month (engine 2cbe08a), "not working" while its failures run since its last answer. */
export type KeyTest = { at: string; ok: boolean; level: string; message: string };
/** `test`: the page's own last test of the saved key (common-data/shared-state/key-tests.json). One that passed after the
 *  bots' last failure says the key and the provider answer now: "ready", with both times (owner, 2026-11-12: Gonka's test
 *  passed while the row still said Not working from a 16:06 failure no bot had called past). */
export function healthLine(h: Health | undefined, day: string, test?: KeyTest | null): { state: "limited" | "not working" | "ready"; note: string } | null {
  if (!h) return null;
  if (h.spent && (h.spent === day || h.spent === day.slice(0, 7))) return { state: "limited", note: `Allowance spent ${h.spent === day ? "today: back at midnight" : "this month: back on the 1st"}` };
  if (h.last_fail && (!h.last_ok || h.last_fail > h.last_ok)) {
    const since = (h.first_fail ?? h.last_fail).replace("T", " ").slice(11, 16);
    const why = h.last_reason ? ` (${h.last_reason})` : "";
    if (test && test.at > h.last_fail) {
      const t = test.at.replace("T", " ").slice(11, 16);
      if (test.ok) return { state: "ready", note: `Test passed at ${t}; the bots' last call failed at ${h.last_fail.slice(11, 16)}${why} and clears on their next good one` };
      return { state: "not working", note: `Not answering since ${since}${why}; test at ${t}: ${test.message}` };
    }
    return { state: "not working", note: `Not answering since ${since}${why}` };
  }
  return null;
}
