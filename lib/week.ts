import { dayStartOf, weekStartDay } from "./periods";

/** The first day of this week (00:00 local) as YYYY-MM-DD. `day` is the company's week start, settings.updates.weekStartDay:
 *  0 = Sunday ... 6 = Saturday; Monday when unset. */
export function weekStart(now = new Date(), day = 1, tz?: string | null): string {
  return weekStartDay(now, day, tz);
}
/** In the company's zone when `tz` is given (settings.timezone), so another machine does not shift the week. */
export const weekStartDate = (now = new Date(), day = 1, tz?: string | null) => dayStartOf(weekStart(now, day, tz), tz);
/** The company's week start from its settings (no query: it rides on who.settings). */
export const startDayOf = (settings: { updates?: { weekStartDay?: number } } | null | undefined) => {
  const d = settings?.updates?.weekStartDay;
  return typeof d === "number" && d >= 0 && d <= 6 ? d : 1;
};
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
