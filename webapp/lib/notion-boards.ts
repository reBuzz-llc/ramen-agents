// Server-side only: the Notion boards the dashboard reads, from The CEO's config rather than hard-coded ids, so a new
// family only fills its config: [notion] database_id is The CEO's task board, [leads] database_id the Leads board
// (both are data source ids). Empty when not set.
import path from "node:path";
import { BOTS_DIR, readConfig } from "./bots";

export async function notionBoards(): Promise<{ tasks: string; leads: string }> {
  try {
    const cfg = await readConfig(path.join(BOTS_DIR, "the-ceo", "config.toml"));
    return { tasks: String(cfg.get("notion.database_id") ?? "").trim(), leads: String(cfg.get("leads.database_id") ?? "").trim() };
  } catch {
    return { tasks: "", leads: "" };
  }
}
