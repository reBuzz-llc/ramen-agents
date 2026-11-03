/** The first day of this week (00:00 local) as YYYY-MM-DD. `day` is the company's week start, settings.updates.weekStartDay:
 *  0 = Sunday ... 6 = Saturday; Monday when unset. */
export function weekStart(now = new Date(), day = 1): string {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() - day + 7) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
export const weekStartDate = (now = new Date(), day = 1) => new Date(`${weekStart(now, day)}T00:00:00`);
/** The company's week start from its settings (no query: it rides on who.settings). */
export const startDayOf = (settings: { updates?: { weekStartDay?: number } } | null | undefined) => {
  const d = settings?.updates?.weekStartDay;
  return typeof d === "number" && d >= 0 && d <= 6 ? d : 1;
};
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
