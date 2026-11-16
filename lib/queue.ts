// "Our queue": the rows the team can finish today, from the company's Leads board (lib/lead-queue.ts reads them):
//   - a Draft email that is not a "skip:" note;
//   - Status empty, "WhatsApp Verified" or "Ready to Send Email" (a WhatsApp check is not an email decision);
//   - no Result yet (Result is the team's);
//   - best Lead score first, then by business name.
// Each row is one kind of task: "review" (a draft nobody has approved yet) or "send" (approved, still to send). The only
// writes are Status: "Ready to Send Email" (reviewed) and "Email Sent" (sent). Nothing is ever sent from here.
// The open tasks of the task board are listed beside them.

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

export const STATUS_REVIEWED = "Ready to Send Email";
export const STATUS_SENT = "Email Sent";
export const WRITABLE = [STATUS_REVIEWED, STATUS_SENT] as const;

// ---- the task board ----------------------------------------------------------------------------------------------

export type TaskRow = {
  pageId: string;
  task: string;
  status: string;
  priority: string;
  deadline: string;
  assignees: string[];
  mine: boolean;
  /** "peek": the task lives on the board and is worked here. */
  source?: "peek";
  checklist?: { text: string; done: boolean }[];
  details?: string;
  standing?: boolean;
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
        flags: flags.get(id) ?? [],
        takenBy: c ? { name: c.name, mine: c.userId === me.userId } : null,
      };
    })
    .sort((a, b) => Number(b.standing) - Number(a.standing) || Number(b.mine) - Number(a.mine) || rank(a.priority) - rank(b.priority) || (a.deadline || "9").localeCompare(b.deadline || "9"));
}
