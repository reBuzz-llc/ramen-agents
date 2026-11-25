// The queue's row and task shapes (lib/lead-queue.ts builds the rows from Peek's own leads) and the team's open tasks,
// ordered for the viewer (peekTasksOf). The Notion-era readers went with Notion.

export type QueueKind = "review" | "send";

export type QueueRow = {
  kind: QueueKind;
  pageId: string;
  url: string;
  business: string;
  contact: string;
  role: string;
  email: string;
  website: string;
  whatsapp: string;
  draft: string;
  whatsappDraft: string;
  /** The list carries the drafts' first characters only; the card reads the full text when opened (/api/queue/draft). */
  draftCut: boolean;
  score: number | null;
  status: string;
  // for the filters
  industry: string;
  location: string;
  pkg: string;
  created: string;
  /** The names of the files attached for its email (Peek's board only): "Copy draft" ends with "Attachments: …". */
  attachments?: string[];
};

// ---- the task board, read only ------------------------------------------------------------------------------------

export type TaskRow = {
  pageId: string;
  url: string;
  task: string;
  status: string;
  priority: string;
  deadline: string;
  assignees: string[];
  mine: boolean;
  /** "peek": the task lives in Peek and is worked here; "notion" (or none): read only, from Notion. */
  source?: "peek" | "notion";
  checklist?: { text: string; done: boolean }[];
  details?: string;
  standing?: boolean;
  uid?: string;
  flags?: { rule: string; detail: string }[];
  takenBy?: { name: string; mine: boolean } | null;
};

const CLOSED = new Set(["Done", "Not Fisible", "Dublicate"]);
const rank = (p: string) => (/^P(\d)$/.test(p) ? Number(p.slice(1)) : p === "Medium" ? 3.5 : 9);

/** Peek's own tasks as queue items of kind "task": open ones only (not Done, Not Fisible,
 *  Dublicate, nor archived); the standing task pinned first, then the viewer's, then by priority and deadline. A task
 *  is the viewer's when they are among its assignees (by name or email) or took it. */
export function peekTasksOf(
  rows: Record<string, unknown>[],
  me: { userId: string; name: string; email: string },
  taken: Map<string, { userId: string; name: string }>,
  flags: Map<string, { rule: string; detail: string }[]> = new Map(),
): TaskRow[] {
  const mineByName = (a: string) => [me.name, me.email].some((x) => x && a.trim().toLowerCase() === x.trim().toLowerCase());
  return rows
    .filter((t) => !t.archived && !CLOSED.has(String(t.status ?? "")))
    .map((t) => {
      const id = String(t.id);
      const assignees = (t.assignees as string[] | null) ?? [];
      const c = taken.get(id);
      return {
        pageId: id,
        url: String(t.notion_url ?? ""),
        task: String(t.title ?? "") || "Untitled task",
        status: String(t.status ?? ""),
        priority: String(t.priority ?? ""),
        deadline: String(t.due ?? ""),
        assignees,
        mine: assignees.some(mineByName) || c?.userId === me.userId,
        source: "peek" as const,
        checklist: (t.checklist as { text: string; done: boolean }[] | null) ?? [],
        details: String(t.details ?? ""),
        standing: !!t.standing,
        uid: String(t.notion_uid ?? ""),
        flags: flags.get(id) ?? [],
        takenBy: c ? { name: c.name, mine: c.userId === me.userId } : null,
      };
    })
    .sort((a, b) => Number(b.standing) - Number(a.standing) || Number(b.mine) - Number(a.mine) || rank(a.priority) - rank(b.priority) || (a.deadline || "9").localeCompare(b.deadline || "9"));
}
