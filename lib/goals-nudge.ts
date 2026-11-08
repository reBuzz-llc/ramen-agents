// The owner's nudge to set the week's key results: the Guide and This week measure the team against
// Settings → Company's key results, and with none set they measure nothing. Owner only; gone once any is set.
import type { Role } from "./roles";

type KeyResults = { sent?: number; replies?: number; meetings?: number; tasksDone?: number } | undefined;

/** True when at least one key result is a number above zero. */
export const keyResultsSet = (kr: KeyResults) => Object.values(kr ?? {}).some((v) => typeof v === "number" && v > 0);

/** Show the nudge: the owner, and no key results yet. */
export const showGoalsNudge = (role: Role, kr: KeyResults) => role === "owner" && !keyResultsSet(kr);
