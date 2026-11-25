// The lead panel's up and down arrows: the row above and the row below in the list the lead was opened from, as it was
// filtered and sorted. Pure, tested.

export type LeadNav = { at: number; total: number; prev: string | null; next: string | null };

/** Where this lead stands in the list. Null when it is not in the list (a link to a lead the filters hide). */
export function navOf(order: string[], id: string): LeadNav | null {
  const i = order.indexOf(id);
  if (i < 0) return null;
  return { at: i + 1, total: order.length, prev: order[i - 1] ?? null, next: order[i + 1] ?? null };
}
