// "Our queue": the rows the team can finish today, from the company's own Notion Leads board. The rules, as a pure function
// so they are tested apart from Notion (they match the dashboard's Send today of 2026-10-14):
//   - a Draft email that is not a "skip:" note;
//   - Status empty, "WhatsApp Verified" or "Ready to Send Email" (a WhatsApp check is not an email decision);
//   - no Result yet (Result is the team's, set in Notion);
//   - best Lead score first, then by business name.
// Each row is one kind of task: "review" (a draft nobody has approved yet) or "send" (approved, still to send). The only
// writes are Status: "Ready to Send Email" (reviewed) and "Email Sent" (sent). Nothing is ever sent from here.
// Open tasks from the task board are listed beside them, read only.

export type NotionProp = Record<string, unknown>;
export type NotionPage = { id: string; url?: string; created_time?: string; last_edited_time?: string; properties: Record<string, NotionProp> };

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
const NOT_SENT = new Set(["", "WhatsApp Verified", STATUS_REVIEWED]);

export function text(p: NotionProp | undefined): string {
  if (!p) return "";
  const t = p.type as string;
  const v = p[t] as unknown;
  if (t === "select" || t === "status") return String((v as { name?: string } | null)?.name ?? "");
  if (t === "url" || t === "email" || t === "phone_number") return String(v ?? "");
  if (t === "number") return v === null || v === undefined ? "" : String(v);
  if (t === "people") return ((v as { name?: string }[] | null) ?? []).map((u) => u.name ?? "").join(", ");
  if (Array.isArray(v)) return v.map((x) => String((x as { plain_text?: string }).plain_text ?? "")).join("");
  return "";
}

/** A Notion people cell: each person's id, name and (when the integration may read it) email. */
export function peopleOf(p: NotionProp | undefined): { id: string; name: string; email: string }[] {
  if (!p || p.type !== "people") return [];
  return ((p.people as { id?: string; name?: string; person?: { email?: string } }[] | null) ?? []).map((u) => ({
    id: String(u.id ?? ""),
    name: String(u.name ?? ""),
    email: String(u.person?.email ?? "").toLowerCase(),
  }));
}

export function queueOf(pages: NotionPage[]): QueueRow[] {
  const rows: QueueRow[] = [];
  for (const p of pages) {
    const P = p.properties;
    const draft = text(P["Draft email"]).trim();
    const status = text(P.Status);
    if (!draft || /^skip\s*:/i.test(draft) || !NOT_SENT.has(status) || text(P.Result)) continue;
    const score = text(P["Lead score"]);
    rows.push({
      kind: status === STATUS_REVIEWED ? "send" : "review",
      pageId: p.id,
      url: p.url ?? "",
      business: text(P.Business),
      contact: text(P["Contact person"]),
      role: text(P["Contact role"]),
      email: text(P["Business email"]),
      website: text(P.Website),
      whatsapp: text(P.Whatsapp),
      draft,
      whatsappDraft: text(P["Draft Whatsapp msg"]).trim(),
      draftCut: Boolean(P["Draft email"]?.cut || P["Draft Whatsapp msg"]?.cut),
      score: score === "" || Number.isNaN(Number(score)) ? null : Number(score),
      status,
      industry: text(P.Industry),
      location: text(P.Location),
      pkg: text(P["How can I help"]),
      created: p.created_time ?? "",
    });
  }
  return rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.business.localeCompare(b.business));
}

/** Rows marked Email Sent since `from` (an ISO date), by last edit: the week's count for the "sent" key result. */
export function sentSince(pages: NotionPage[], from: string): number {
  return pages.filter((p) => text(p.properties.Status) === STATUS_SENT && (p.last_edited_time ?? "").slice(0, 10) >= from).length;
}

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

/** Open tasks (not Done, Not Fisible or Dublicate): the viewer's own first, then by priority (P0 first) and deadline. */
export function tasksOf(pages: NotionPage[], me: { email: string; notionUserId?: string | null }): TaskRow[] {
  return pages
    .filter((p) => !CLOSED.has(text(p.properties.Status)))
    .map((p) => {
      const who = peopleOf(p.properties.Assign);
      return {
        pageId: p.id,
        url: p.url ?? "",
        task: text(p.properties.Task) || "Untitled task",
        status: text(p.properties.Status),
        priority: text(p.properties.Priority),
        deadline: String((p.properties["Dead Line"]?.date as { start?: string } | null)?.start ?? ""),
        assignees: who.map((u) => u.name),
        mine: who.some((u) => (me.notionUserId && u.id === me.notionUserId) || (!!u.email && u.email === me.email.toLowerCase())),
      };
    })
    .sort((a, b) => Number(b.mine) - Number(a.mine) || rank(a.priority) - rank(b.priority) || (a.deadline || "9").localeCompare(b.deadline || "9"));
}

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
