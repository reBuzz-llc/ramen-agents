// Settings as a section: one page per kind, in this order; /settings opens the first. A page shows only
// to the roles that can use it; the others are read-only for members where they were before.
import { can, type Action, type Role } from "./roles";

export type SettingsPage = { slug: string; label: string; lead: string; needs?: Action };

export const SETTINGS: readonly SettingsPage[] = [
  { slug: "company", label: "Company", lead: "The working week, the update cadence and this week's key results." },
  { slug: "people", label: "People", lead: "Who is on the team, their roles and their own pay rates." },
  { slug: "board", label: "Board", lead: "The Notion board the queue and the leads are read from.", needs: "settings.notion" },
  { slug: "rates", label: "Rates & points", lead: "Default pay for new members and the leaderboard's points per outcome." },
  { slug: "keys", label: "API keys", lead: "The keys your agents use to read and write the board. Shown once when made.", needs: "keys.manage" },
  { slug: "my-view", label: "My view", lead: "The lead drawer as you like it: the order of its fields, the ones you keep hidden, and empty fields shown or not. Yours on every browser." },
  { slug: "appearance", label: "Appearance", lead: "Light or dark, and the text size, on this browser." },
];

/** The pages this role sees, in nav order. */
export const settingsFor = (role: Role) => SETTINGS.filter((p) => !p.needs || can(role, p.needs));

export const settingsPage = (slug: string) => SETTINGS.find((p) => p.slug === slug)!;

/** The browser tab's title for a settings page. */
export const settingsTitle = (slug: string) => `${settingsPage(slug).label} · Settings · ramen-agents`;

/** Where a Settings form comes back to after it posts: the page its action lives on. */
export function sectionOf(action: string): string {
  if (action.startsWith("notion")) return "board";
  if (action === "rates" || action === "points") return "rates";
  if (action === "role" || action === "memberRate") return "people";
  return "company";
}
