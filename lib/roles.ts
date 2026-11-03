// Who may do what. Three roles per company: the owner (one per tenant, everything), a manager (sees the team, sets the
// week's key results), a member (their own queue, clock and week). One table, so every route asks the same question.
export type Role = "owner" | "manager" | "member";

export type Action =
  | "queue.work" // see the queue, mark reviewed / sent
  | "clock.own" // clock in and out, annotate own gaps
  | "week.own" // see own week
  | "week.team" // see everyone's week and timesheets
  | "settings.keyResults" // set the week's key results
  | "settings.rates" // set the company's default pay rates and leaderboard points
  | "rates.members" // set a person's own pay rate (lib/rates.ts canSetRate says whose)
  | "settings.notion" // connect or change the Notion board
  | "users.manage" // change roles
  | "users.add" // add a person by Google address, remove one (a manager: members only, lib/team.ts)
  | "leads.import" // import leads from a CSV or spreadsheet (lib/lead-import.ts)
  | "projects.manage" // add and close the projects people clock in to
  | "keys.manage"; // mint and revoke the board API's machine keys (Settings > API keys)

const ALLOWED: Record<Role, ReadonlySet<Action>> = {
  owner: new Set<Action>(["queue.work", "clock.own", "week.own", "week.team", "settings.keyResults", "settings.rates", "rates.members", "settings.notion", "users.manage", "users.add", "leads.import", "projects.manage", "keys.manage"]),
  manager: new Set<Action>(["queue.work", "clock.own", "week.own", "week.team", "settings.keyResults", "rates.members", "users.add", "leads.import", "projects.manage"]),
  member: new Set<Action>(["queue.work", "clock.own", "week.own"]),
};

export const can = (role: Role, action: Action) => ALLOWED[role].has(action);

/** A role change: only the owner changes roles, nobody makes a second owner, and the owner cannot demote themselves. */
export function canSetRole(actor: { id: string; role: Role }, target: { id: string; role: Role }, to: Role): boolean {
  if (actor.role !== "owner") return false;
  if (to === "owner") return false;
  if (target.id === actor.id) return false;
  return true;
}
