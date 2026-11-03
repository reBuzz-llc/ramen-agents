// Choosing a company's boards without knowing what a data source id is: the token's search results become a list of
// boards (title and a few column names), and a pasted Notion URL or id becomes an id. Pure functions, tested apart from
// Notion; the calls themselves are in notion.ts.

export type Board = { id: string; title: string; columns: string[]; leadsLike: boolean; tasksLike: boolean };

// What a person reads when a step fails: what to do next, not what went wrong inside.
export const NOT_ACCEPTED = "Notion did not accept that token. Copy it again from your integration's page in Notion (it starts with ntn_ or secret_).";
export const NONE_SHARED =
  "The token works, but no board is shared with it yet. In Notion, open your Leads board, click ··· (top right) → Connections, and add your integration. Then try again.";

/** A later read refused with 401: the saved token stopped working (revoked, or a bad paste). */
export const REJECTED = "Notion rejected the saved token. Reconnect in Settings.";

/** The columns Our queue reads; a Leads board without them would show an empty queue. */
export const LEADS_COLUMNS = ["Status", "Draft email"];

/** The 32 hex digits of a Notion id, from an id (with or without dashes) or any Notion URL; dashed, or null. The
 *  id in a board's URL is the last 32-hex run before "?" (a "?v=" view id comes after it and is not the board). */
export function idFromInput(raw: string): string | null {
  const path = raw.trim().split("?")[0];
  // Whole ids only: a page slug before the id ("Feed-3e3d...") ends in letters that are also hex digits.
  const runs = path.match(/(?<![0-9a-f])[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}(?![0-9a-f])/gi);
  if (!runs) return null;
  const h = runs[runs.length - 1].replace(/-/g, "").toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

type RichText = { plain_text?: string }[];
type SearchResult = { object?: string; id: string; title?: RichText; properties?: Record<string, { type?: string }>; in_trash?: boolean; archived?: boolean };

export function boardOf(r: SearchResult): Board {
  const columns = Object.keys(r.properties ?? {});
  const has = (c: string) => columns.some((x) => x.toLowerCase() === c.toLowerCase());
  return {
    id: r.id,
    title: (r.title ?? []).map((t) => t.plain_text ?? "").join("").trim() || "Untitled",
    columns,
    leadsLike: LEADS_COLUMNS.every(has),
    tasksLike: has("Status") && (has("Assign") || has("Assignee")),
  };
}

/** The boards in a search response, likely Leads boards first, then by title; trashed ones left out. */
export function boardsFrom(results: SearchResult[]): Board[] {
  return results
    .filter((r) => r.object === "data_source" && !r.in_trash && !r.archived)
    .map(boardOf)
    .sort((a, b) => Number(b.leadsLike) - Number(a.leadsLike) || a.title.localeCompare(b.title));
}

/** The Leads columns a board lacks, by name. */
export const missingLeadsColumns = (b: Board) => LEADS_COLUMNS.filter((c) => !b.columns.some((x) => x.toLowerCase() === c.toLowerCase()));
