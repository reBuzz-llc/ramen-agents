// Settings as a section, since the list keeps growing: a left nav and one page per kind, in this order; /settings opens the first. A page shows only
// to the roles that can use it; the others are read-only for members where they were before.
import { can, type Action, type Role } from "./roles";

export type SettingsPage = { slug: string; label: string; lead: string; needs?: Action };

export const SETTINGS: readonly SettingsPage[] = [
  { slug: "company", label: "Company", lead: "The working week, the update cadence and this week's key results." },
  { slug: "people", label: "People", lead: "Who is on the team, their roles and their own pay rates." },
  { slug: "rates", label: "Rates & points", lead: "Default pay for new members and the leaderboard's points per outcome." },
  { slug: "keys", label: "API keys", lead: "The keys your agents use to read and write the board. Shown once when made.", needs: "keys.manage" },
  { slug: "my-view", label: "My view", lead: "The lead drawer as you like it: the order of its fields, the ones you keep hidden, and empty fields shown or not. Yours on every browser." },
  { slug: "appearance", label: "Appearance", lead: "Light or dark, and the text size, on this browser." },
  { slug: "treasure-hunt", label: "Treasure Hunt", lead: "Your own downloads: apps to install on another computer. Only you see this page.", needs: "treasures" },
];

/** Treasure Hunt is the owner's own page and ships only where the build turns it on (NEXT_PUBLIC_PEEK_TREASURE_HUNT=1). */
export const treasureHuntOn = () => process.env.NEXT_PUBLIC_PEEK_TREASURE_HUNT === "1";

/** The pages this role sees, in nav order. */
export const settingsFor = (role: Role) => SETTINGS.filter((p) => (!p.needs || can(role, p.needs)) && (p.slug !== "treasure-hunt" || treasureHuntOn()));

export const settingsPage = (slug: string) => SETTINGS.find((p) => p.slug === slug)!;

/** The browser tab's title for a settings page. */
export const settingsTitle = (slug: string) => `${settingsPage(slug).label} · Settings · Productive Peek`;

/** Where a Settings form comes back to after it posts: the page its action lives on. */
export function sectionOf(action: string): string {
  if (action === "rates" || action === "points") return "rates";
  if (["role", "memberRate", "name", "person", "removeRate"].includes(action)) return "people"; // one Save, removing a rate
  return "company";
}
