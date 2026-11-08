// One database, many companies (tenants). Every table but `tenants` carries tenant_id, and every query in lib/ filters
// by it: a row of one company is never readable by another. Proprietary; nothing here goes into ramen-agents.
import { sql } from "drizzle-orm";
import { bigint, bigserial, boolean, date, doublePrecision, index, integer, jsonb, pgEnum, pgSequence, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const role = pgEnum("role", ["owner", "manager", "member"]);
export const outcomeKind = pgEnum("outcome_kind", ["reviewed", "sent", "reply", "meeting", "client", "task_done"]);

/** A company. `settings` holds its week's key results and, later, pay rates (empty until the owner sets them). */
export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  settings: jsonb("settings").$type<TenantSettings>().notNull().default(sql`'{}'::jsonb`),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TenantSettings = {
  /** This week's key results, e.g. { sent: 30, replies: 3 }. */
  keyResults?: { sent?: number; replies?: number; meetings?: number; tasksDone?: number };
  /** Pay rates, set by the owner (week 3). Empty means "owner sets"; nothing is computed without them. */
  rates?: { hourly?: number; outcomeBonus?: number; currency?: string };
  timezone?: string;
  /** Leaderboard points per outcome, set by the owner; empty means the defaults in lib/leaderboard.ts. */
  points?: { sent?: number; replies?: number; meetings?: number; clients?: number; tasksDone?: number };
  /** Settings → Time & updates: the default update cadence (with history), rounding of shift times for pay and totals,
   *  the week's first day (0 Sunday … 6; default 1, Monday) and idle handling (a placeholder, off). */
  updates?: {
    defaultHistory?: { from: string; minutes: number | null }[];
    rounding?: 0 | 5 | 15;
    weekStartDay?: number;
    idle?: "off";
  };
};

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    role: role("role").notNull().default("member"),
    /** Their Notion user id, so "Sent by" on the board maps to a person here. */
    notionUserId: text("notion_user_id"),
    active: boolean("active").notNull().default(true),
    /** Their first sign-in (Google, matched by this address). Null: added in Settings → People, not signed in yet. */
    firstSignedInAt: timestamp("first_signed_in_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_tenant_email").on(t.tenantId, t.email)],
);

/** A tenant's Notion integration. The token is AES-256-GCM ciphertext (lib/crypto.ts); the key is only in the env. */
export const notionConnections = pgTable("notion_connections", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }).unique(),
  tokenEncrypted: text("token_encrypted").notNull(),
  leadsDataSource: text("leads_data_source").notNull(),
  tasksDataSource: text("tasks_data_source"),
  // Board titles, read once on Connect, so Settings names the boards without a call to Notion.
  leadsTitle: text("leads_title"),
  tasksTitle: text("tasks_title"),
  // The integration's own name in Notion (GET /v1/users/me on Connect): "connected as ...".
  integrationName: text("integration_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** The board, cached for five minutes (Notion allows 3 requests a second per integration). */
export const boardRows = pgTable(
  "board_rows",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.pageId] })],
);

/** Clock-in / clock-out. An open shift has no endedAt. */
/** What a person works on while clocked in. Owner and managers add them in Settings. A shift with
 *  no project is "General", the default every company has, so General is not a row here. */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    client: text("client").notNull().default(""),
    active: boolean("active").notNull().default(true),
    /** How often people post an update while on it (lib/cadence.ts): entries from a moment on; null = company default. */
    cadenceHistory: jsonb("cadence_history").$type<{ from: string; minutes: number | null }[]>().notNull().default(sql`'[]'::jsonb`),
    /** Who made it: anyone can, from the clock ("Create '...'"); owner and managers tidy up in Settings. */
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("projects_name_once").on(t.tenantId, t.name)],
);

export const shifts = pgTable(
  "shifts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    note: text("note").notNull().default(""),
    /** The project worked on; null is "General". Switching project mid-day closes this shift and opens another. */
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
  },
  (t) => [index("shifts_user_day").on(t.tenantId, t.userId, t.startedAt)],
);

/** "What are you working on": short notes a person posts while clocked in, each on the shift running then. The whole team sees them; posting one never changes the shift. */
export const shiftNotes = pgTable(
  "shift_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    text: text("text").notNull(),
    /** The client's Idempotency-Key for the submission that made it: a retried or repeated submit returns this note. */
    clientKey: text("client_key"),
  },
  (t) => [
    index("shift_notes_shift").on(t.shiftId, t.at),
    index("shift_notes_tenant_at").on(t.tenantId, t.at),
    uniqueIndex("shift_notes_client_key").on(t.userId, t.clientKey),
  ],
);

/** A person's note on a gap in their day ("lunch", "client call away from the laptop"). */
export const gapNotes = pgTable("gap_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromAt: timestamp("from_at", { withTimezone: true }).notNull(),
  toAt: timestamp("to_at", { withTimezone: true }).notNull(),
  note: text("note").notNull(),
});

/** What a person moved: reviewed or sent a lead, a reply, a meeting, a task done. */
/** Who has taken a lead: one person per lead, so two people never send the same email. Kept here, never in Notion. */
export const claims = pgTable(
  "claims",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.pageId] }), index("claims_person").on(t.tenantId, t.userId)],
);

export const outcomes = pgTable(
  "outcomes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    pageId: text("page_id").notNull(),
    kind: outcomeKind("kind").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** "teams" when recorded by a click here, "board" when read from Notion. */
    source: text("source").notNull().default("teams"),
  },
  (t) => [index("outcomes_tenant_at").on(t.tenantId, t.at), index("outcomes_person_at").on(t.tenantId, t.userId, t.at)],
);

/** Sign-in sessions (a cookie holds the random id; the table holds its SHA-256). */
export const authSessions = pgTable("auth_sessions", {
  idHash: text("id_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Magic links: single use, short-lived, stored only as a hash. */
export const magicLinks = pgTable("magic_links", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
});

/** A person's weekly statement. Drafts are computed live; an approved one is frozen here exactly as it was approved. */
export const statements = pgTable(
  "statements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    weekStart: text("week_start").notNull(),
    data: jsonb("data").notNull(),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("statements_one_per_week").on(t.tenantId, t.userId, t.weekStart)],
);

/** Each person's acknowledgment of a version of the notice, with when. A new notice version needs a new acknowledgment. */
export const acknowledgments = pgTable(
  "acknowledgments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    noticeVersion: text("notice_version").notNull(),
    acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("ack_once_per_version").on(t.userId, t.noticeVersion)],
);

/**
 * A person's pay rates from a day on: on any day the newest row whose effective_from is
 * on or before it applies; with no row, the tenant's defaults. Rows are never edited, only added, so a past statement
 * never moves when a rate changes. Money in cents. Owner and managers see these; teammates never do, and nothing here
 * reaches the leaderboard or the agents.
 */
export const memberRates = pgTable(
  "member_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    effectiveFrom: text("effective_from").notNull(), // YYYY-MM-DD
    hourlyCents: integer("hourly_cents"),
    outcomeBonusCents: integer("outcome_bonus_cents"),
    currency: text("currency").notNull().default("USD"),
    setBy: uuid("set_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("member_rates_one_per_day").on(t.tenantId, t.userId, t.effectiveFrom), index("member_rates_person").on(t.tenantId, t.userId)],
);

/**
 * The Leads board, moved from Notion. One row per business, one column per board field, under its Neon name. Notion's
 * mixed Status is two fields, email and WhatsApp. Every change goes through lib/leads.ts, which writes `lead_cells`
 * first: who changed what, from what, and whether it was refused. `rev` rises on every change (one sequence for all
 * companies), so a reader asks for "what changed after rev N" and misses nothing written in the same second.
 */
export const leadsRev = pgSequence("leads_rev_seq");
export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    notionPageId: text("notion_page_id"),
    notionUrl: text("notion_url"),
    notionUid: text("notion_uid"),
    business: text("business").notNull(),
    website: text("website"),
    domain: text("domain"),
    businessEmail: text("business_email"),
    emailCheck: text("email_check"),
    location: text("location"),
    city: text("city"),
    state: text("state"),
    industry: text("industry"),
    size: text("size"),
    contactPerson: text("contact_person"),
    contactRole: text("contact_role"),
    founderLinkedin: text("founder_linkedin"),
    linkedinVia: text("linkedin_via"),
    whatsapp: text("whatsapp"),
    mapLink: text("map_link"),
    painPoint: text("pain_point"),
    package: text("package"),
    evidence: text("evidence"),
    /** One line of the Google listing's facts (rating, reviews, kind, hours) for a pain point to stand on; never a proof URL
     *  (that is evidence, the proof link). */
    listingEvidence: text("listing_evidence"),
    sourcePages: text("source_pages"),
    toolsOnSite: text("tools_on_site").array(),
    siteHealth: text("site_health"),
    leadScore: doublePrecision("lead_score"),
    draftEmail: text("draft_email"),
    draftWhatsapp: text("draft_whatsapp"),
    // The bot's last draft before a person rewrote it: written only when a person edits the draft and
    // the cell's previous editor was a bot, never shown as the live cell. A person's rewrite of it is a training example.
    botDraft: text("bot_draft"),
    botWhatsapp: text("bot_whatsapp"),
    emailStatus: text("email_status"),
    whatsappStatus: text("whatsapp_status"),
    result: text("result"),
    resultDate: date("result_date", { mode: "string" }),
    sentBy: text("sent_by").array(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    foundBy: text("found_by"),
    /** A phone number and free notes, from an owner's import; the board had neither. */
    phone: text("phone"),
    notes: text("notes"),
    /** The street address, and the map listing's facts (rating, reviews, price range, place id) for the Lead score. */
    address: text("address"),
    listing: jsonb("listing").$type<{ rating?: number; reviews?: number; price_range?: string; place_id?: string }>(),
    archived: boolean("archived").notNull().default(false),
    lastActorName: text("last_actor_name"),
    lastActorKind: text("last_actor_kind"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rev: bigint("rev", { mode: "number" }).notNull().default(sql`nextval('leads_rev_seq')`),
  },
  (t) => [
    uniqueIndex("leads_notion_page").on(t.tenantId, t.notionPageId),
    index("leads_status").on(t.tenantId, t.emailStatus, t.whatsappStatus),
    index("leads_domain").on(t.tenantId, t.domain),
    index("leads_updated").on(t.tenantId, t.updatedAt),
    index("leads_rev").on(t.tenantId, t.rev),
  ],
);

/** Every cell change, and every refused attempt, on a lead: the board's history and the person-wins rule's memory. */
export const leadCells = pgTable(
  "lead_cells",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    column: text("column").notNull(),
    old: jsonb("old"),
    new: jsonb("new"),
    /** "person" (a the portal user, by userId) or "bot" (an agent or job, through an API key). */
    actorKind: text("actor_kind").notNull(),
    actorName: text("actor_name").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    /** The API key the write came through, by name ("engine", "validator", "backfill"); null for a person. */
    via: text("via"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    sourceUrl: text("source_url"),
    /** "applied", or "refused" with the reason: person_wins, human_only, filled. */
    outcome: text("outcome").notNull().default("applied"),
    reason: text("reason"),
  },
  (t) => [index("lead_cells_lead").on(t.leadId, t.column, t.id), index("lead_cells_tenant").on(t.tenantId, t.id)],
);

/** A machine's key to the board API (the engine, the Validator, the backfill), stored as SHA-256 only. The key fixes the
 *  company; its scopes say what it may do: board:read, board:write, board:import (the backfill: an upsert that keeps
 *  Notion's values as they are). Minted with scripts/api-key.mjs into the fleet's common-data/keys/portal-<name>.key. */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: text("scopes").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** Sign-in codes (local or outage mode): the portal running on the owner's own machine behind a tunnel, or while the
 *  hosted sign-in is out, has no Neon Auth, so the owner issues a person a one-time code (shown once, kept hashed, 14 days). A person
 *  signs in with their email and a live code; issuing a new code revokes the older ones. Used only with PEEK_LOCAL_MODE=1. */
export const localCodes = pgTable(
  "local_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    codeHash: text("code_hash").notNull().unique(),
    issuedBy: text("issued_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  },
  (t) => [index("local_codes_user").on(t.userId)],
);

/** What each API key pulled, day by day (to keep within a free tier's data transfer): the
 *  requests and the bytes answered, so the team sees who pulls what. */
export const apiKeyDays = pgTable(
  "api_key_days",
  {
    keyId: uuid("key_id").notNull().references(() => apiKeys.id, { onDelete: "cascade" }),
    day: date("day", { mode: "string" }).notNull(),
    requests: integer("requests").notNull().default(0),
    notModified: integer("not_modified").notNull().default(0),
    bytes: bigint("bytes", { mode: "number" }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.keyId, t.day] })],
);

/** A list a machine hands the board, kept as it was sent: today "send-next", the Validator's pick of the leads to send
 *  next (pushed with its key, PUT /v1/lists/send-next), shown on the Leads page's Send next tab. */
export const leadLists = pgTable(
  "lead_lists",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: text("updated_by"),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.name] })],
);

/** The Validator's flags on a lead: one per rule, open or resolved; a flag
 *  raised again reopens. The drawer shows the open ones; the board filters on them. */
export const leadFlags = pgTable(
  "lead_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    rule: text("rule").notNull(),
    detail: text("detail").notNull().default(""),
    status: text("status").notNull().default("open"),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    actor: text("actor"),
  },
  (t) => [uniqueIndex("lead_flags_rule").on(t.leadId, t.rule), index("lead_flags_open").on(t.tenantId, t.status)],
);

/**
 * The team's tasks, moved from Notion's "Tasks
 * Tracker" like the Leads board: written only through lib/tasks.ts, every change in `task_cells`, `rev` from its own
 * sequence. `assignees` keeps the names as given (Notion's people, or a the portal user's name); `projects` the Notion
 * relation ids the backfill copies; `checklist` the "Done when" items a person ticks. `standing` marks The CEO's
 * persistent send task: pinned at the top of the queue, never done.
 */
export const tasksRev = pgSequence("tasks_rev_seq");
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    notionPageId: text("notion_page_id"),
    notionUrl: text("notion_url"),
    notionUid: text("notion_uid"),
    title: text("title").notNull(),
    status: text("status").notNull().default("Not started"),
    priority: text("priority"),
    assignees: text("assignees").array(),
    due: date("due", { mode: "string" }),
    projects: text("projects").array(),
    blocker: text("blocker"),
    files: text("files").array(),
    details: text("details"),
    checklist: jsonb("checklist").$type<{ text: string; done: boolean }[]>(),
    standing: boolean("standing").notNull().default(false),
    archived: boolean("archived").notNull().default(false),
    createdBy: text("created_by"),
    lastActorName: text("last_actor_name"),
    lastActorKind: text("last_actor_kind"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    rev: bigint("rev", { mode: "number" }).notNull().default(sql`nextval('tasks_rev_seq')`),
  },
  (t) => [uniqueIndex("tasks_notion_page").on(t.tenantId, t.notionPageId), index("tasks_rev").on(t.tenantId, t.rev), index("tasks_status").on(t.tenantId, t.status)],
);

/** Every cell change, and every refused attempt, on a task (as lead_cells for leads). */
export const taskCells = pgTable(
  "task_cells",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    column: text("column").notNull(),
    old: jsonb("old"),
    new: jsonb("new"),
    actorKind: text("actor_kind").notNull(),
    actorName: text("actor_name").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    via: text("via"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    outcome: text("outcome").notNull().default("applied"),
    reason: text("reason"),
  },
  (t) => [index("task_cells_task").on(t.taskId, t.column, t.id), index("task_cells_tenant").on(t.tenantId, t.id)],
);

/** The Validator's T-rule flags on a task (the lead_flags contract). */
export const taskFlags = pgTable(
  "task_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").notNull().references(() => tasks.id, { onDelete: "cascade" }),
    rule: text("rule").notNull(),
    detail: text("detail").notNull().default(""),
    status: text("status").notNull().default("open"),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    actor: text("actor"),
  },
  (t) => [uniqueIndex("task_flags_rule").on(t.taskId, t.rule), index("task_flags_open").on(t.tenantId, t.status)],
);

/** The team's files: PDFs, and PNG/JPG for logos, up to 25 MB, kept in Neon Object Storage (the bucket in neon.ts) under
 *  `key`; this row is what the app knows about it. A file is "pending" until its upload is confirmed, and is never
 *  hard-deleted here: deleting removes the object and stamps deleted_at, so the history keeps its name. */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    size: integer("size").notNull(),
    contentType: text("content_type").notNull(),
    tag: text("tag").notNull().default(""),
    status: text("status").notNull().default("pending"),
    /** Which object store holds the bytes (files can move from one store to another): "neon",
     *  "supabase" or "local"; a file whose store is not the one in use reads "copy pending" until files-copy moves it. */
    store: text("store").notNull().default("neon"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("files_tenant").on(t.tenantId, t.createdAt)],
);

/** Every action on a file, with its actor: upload, rename, tag, delete, attach and detach (to a lead). */
export const filesHistory = pgTable(
  "files_history",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorName: text("actor_name").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("files_history_file").on(t.fileId, t.id)],
);

/** Which files go with a lead's email: the person sending by hand attaches them. */
export const leadFiles = pgTable(
  "lead_files",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    fileId: uuid("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
    attachedBy: uuid("attached_by").references(() => users.id, { onDelete: "set null" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.fileId] }), index("lead_files_tenant").on(t.tenantId)],
);

/** An owner's or manager's import of leads from a CSV or spreadsheet: who, when, which file, the
 *  counts, and the report of every row skipped or rejected and why (downloadable). */
export const leadImports = pgTable(
  "lead_imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    byUserId: uuid("by_user_id").references(() => users.id, { onDelete: "set null" }),
    byName: text("by_name").notNull(),
    fileName: text("file_name").notNull().default(""),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    created: integer("created").notNull().default(0),
    skipped: integer("skipped").notNull().default(0),
    rejected: integer("rejected").notNull().default(0),
    report: jsonb("report").$type<{ row: number; business: string; outcome: string; reason: string; leadId?: string }[]>().notNull(),
  },
  (t) => [index("lead_imports_tenant").on(t.tenantId, t.at)],
);

// The Asset page: what the company sells, edited by the owner and managers, so the owner's Notion
// "What we have" page can retire. A rate is one line as Notion's Rates block had it ("Offer: price"); a package is the
// offer the CEO publishes. `position` is the owner's order on the page (1 first).
export const assetRates = pgTable(
  "asset_rates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    line: text("line").notNull(),
    updatedBy: text("updated_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asset_rates_tenant").on(t.tenantId, t.position)],
);

export const assetPackages = pgTable(
  "asset_packages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    name: text("name").notNull(),
    price: text("price").notNull().default(""),
    offer: text("offer").notNull().default(""),
    buyer: text("buyer").notNull().default(""),
    deliverables: text("deliverables").array().notNull().default(sql`'{}'::text[]`),
    status: text("status").notNull().default("draft"),
    // The ready-to-send email the Outreach Writer builds a package's first email on (as the Notion toggle had it).
    email: text("email").notNull().default(""),
    // A bot's handover: who handed it over and when, with its reasons and the pages it read. Only
    // POST /v1/assets/packages/drafts sets these; the page and the owner's PUT keep them as they are.
    why: text("why").notNull().default(""),
    sources: text("sources").array().notNull().default(sql`'{}'::text[]`),
    handedOverBy: text("handed_over_by"),
    handedOverAt: timestamp("handed_over_at", { withTimezone: true }),
    updatedBy: text("updated_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asset_packages_tenant").on(t.tenantId, t.position)],
);

/** The Asset page's "What we have" sections: a title and a body in the
 *  page's light markdown (### a toggle, "- " or "1. " a list item, two spaces a level deeper), in order. A "rates" section
 *  shows the rate card (asset_rates) under its body. */
export const assetSections = pgTable(
  "asset_sections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    title: text("title").notNull().default(""),
    kind: text("kind").notNull().default("text"),
    body: text("body").notNull().default(""),
    updatedBy: text("updated_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asset_sections_tenant").on(t.tenantId, t.position)],
);

/** The family's own reports for the team (the reverse of the Guide): what the agents did today and
 *  this week, posted by the Validator with its key (POST /v1/family/report) and shown on /family. Masked text only:
 *  lib/family.ts refuses emails, phone numbers and web addresses (but the week post's own link). `kind` is "tick" (every
 *  few minutes: today's numbers and each member's state line), "morning" (the morning block's lines) or "week" (the
 *  weekly post's title, summary and link); `lines` holds that payload. The newest 50 per kind are kept. */
export const familyReports = pgTable(
  "family_reports",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    lines: jsonb("lines").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    postedBy: text("posted_by").notNull().default(""),
  },
  (t) => [index("family_reports_latest").on(t.tenantId, t.kind, t.at)],
);
