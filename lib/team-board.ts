// Who is on the team's board. An account with the role owner is never listed on This week's table, its Drafts fixed and Follow-ups lines,
// or the leaderboard, and its numbers stay out of the team totals, so the totals equal the people shown. A person the owner
// switched "Not on the team board" (the tenant's settings, offTeamBoard: user ids) is treated the same. Their statement
// page and their own queue are unchanged. Pure.
export type BoardPerson = { id: string; role: string; name?: string | null; email?: string | null };

/** The ids left off the team's board: every owner account, and the people switched off. */
export function offBoardIds(people: BoardPerson[], settings: { offTeamBoard?: unknown } | null | undefined): Set<string> {
  const off = new Set(people.filter((p) => p.role === "owner").map((p) => p.id));
  for (const id of Array.isArray(settings?.offTeamBoard) ? settings.offTeamBoard : []) if (typeof id === "string") off.add(id);
  return off;
}

/** The list without them. */
export const onBoard = <T extends { userId: string }>(rows: T[], off: Set<string>): T[] => rows.filter((r) => !off.has(r.userId));

/** The owner's switch: the settings' list with this person on or off the board (never an owner account, always off). */
export function withOffBoard(list: unknown, userId: string, off: boolean): string[] {
  const cur = (Array.isArray(list) ? list : []).filter((x): x is string => typeof x === "string" && x !== userId);
  return off ? [...cur, userId] : cur;
}
