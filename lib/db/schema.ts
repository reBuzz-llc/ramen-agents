// One database, many companies (tenants). Every table but `tenants` carries tenant_id, and every query in lib/ filters
// by it: a row of one company is never readable by another. Proprietary; nothing here goes into ramen-agents.
import { sql } from "drizzle-orm";
import type { FollowUpDrafts } from "../follow-up-drafts";
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
}).enableRLS();

export type TenantSettings = {
  /** This week's key results, e.g. { sent: 30, replies: 3 }. */
  keyResults?: { sent?: number; replies?: number; meetings?: number };
  /** Pay rates, set by the owner (week 3). Empty means "owner sets"; nothing is computed without them. */
  rates?: { hourly?: number; outcomeBonus?: number; currency?: string };
  /** The company's time zone (IANA name): where its day starts for the daily send goals. Unset: the server's clock. */
  timezone?: string;
  /** Daily send goals per person: first emails and WhatsApp messages a day; unset means 5 and 3. */
  sendGoals?: { email?: number; whatsapp?: number; changedAt?: string };
  /** The live world's address: the owner's Tailscale Funnel address; empty means no frame on Family. */
  worldUrl?: string;
  /** Sample sites: approve a draft as soon as its copy passes the checks (default off: a person approves). */
  samplesAutoPublish?: boolean;
  /** Places the team works from (SB06): never written on a sample page. The owner's; shown to nobody else. */
  ownPlaces?: string[];
  /** People the owner keeps off the team's board: user ids; an owner account is always off. */
  offTeamBoard?: string[];
  /** Reference sites: the owner's marks, each pinned to a version (lib/sample-references.ts); when they changed. */
  sampleReferences?: { sampleId: string; version: number; family: string; setAt: string; setBy: string }[];
  sampleReferencesAt?: string;
  /** Each take-down, so it can be undone: who, when, the optional reason, the mark it removed (lib/sample-takedowns.ts). */
  sampleTakedowns?: { sampleId: string; reason: string; asked: boolean; by: string; at: string; reference?: { version: number; family: string; setAt: string; setBy: string }; undoneBy?: string; undoneAt?: string }[];
  /** When the Mac's publisher last asked for the pages to put up (GET /v1/samples/publish) */
  samplesPublishPolledAt?: string;
  /** Leaderboard points per outcome, set by the owner; empty means the defaults in lib/leaderboard.ts. */
  points?: { sent?: number; replies?: number; meetings?: number; clients?: number };
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
    /** Their own view of the lead drawer (Settings → My view): show_empty, field_order,
     *  hidden_fields. Empty: the default view. */
    viewPrefs: jsonb("view_prefs").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("users_tenant_email").on(t.tenantId, t.email)],
).enableRLS();

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
}).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

/** "What are you working on": short notes a person posts while clocked in, each on the shift running then (owner,
 *  2026-10-14). The whole team sees them; posting one never changes the shift. */
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
).enableRLS();

/** A person's note on a gap in their day ("lunch", "client call away from the laptop"). */
export const gapNotes = pgTable("gap_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fromAt: timestamp("from_at", { withTimezone: true }).notNull(),
  toAt: timestamp("to_at", { withTimezone: true }).notNull(),
  note: text("note").notNull(),
}).enableRLS();

/** What a person moved: reviewed or sent a lead, a reply, a meeting, a task done. */
/** Who has taken a lead: one person per lead, so two people never send the same email. Kept here, never in Notion. */
export const claims = pgTable(
  "claims",
  {
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    pageId: text("page_id").notNull(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** Which pack holds it: "email" (Send next, the email pack) or "whatsapp" (checking and sending
     *  on WhatsApp). One holder per lead either way. */
    kind: text("kind").notNull().default("email"),
  },
  (t) => [primaryKey({ columns: [t.tenantId, t.pageId] }), index("claims_person").on(t.tenantId, t.userId)],
).enableRLS();

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
).enableRLS();

/** Sign-in sessions (a cookie holds the random id; the table holds its SHA-256). */
export const authSessions = pgTable("auth_sessions", {
  idHash: text("id_hash").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}).enableRLS();

/** Magic links: single use, short-lived, stored only as a hash. */
export const magicLinks = pgTable("magic_links", {
  tokenHash: text("token_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
}).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

/**
 * The Leads board, moved from Notion (columns from the Validator's inventory, the engine's
 * common-data/leads-columns.md). One row per business, one column per board field, under its Neon name. Notion's
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
    /** The sample site the team made by hand before the meeting: an https link a
     *  person pastes; Copy draft and Copy message add it. Never written by an agent. */
    sampleUrl: text("sample_url"),
    /** The business's own Instagram and Facebook pages as its public listing names them:
     *  https only, written by the Lead Enricher (a person's edit wins); a sample page shows their icons. */
    instagramUrl: text("instagram_url"),
    facebookUrl: text("facebook_url"),
    painPoint: text("pain_point"),
    package: text("package"),
    evidence: text("evidence"),
    /** One line of the Google listing's facts (rating, reviews, kind, hours) for a pain point to stand on; never a proof URL
     *  (that is evidence, which the Validator's LD02 checks). */
    listingEvidence: text("listing_evidence"),
    // the Enricher's site facts for the Site Builder: one JSON object, replaced whole by
    // each newer write: {area, hours, rating, reviews, quotes, offers, photos, years, languages, sources, at}
    siteFacts: jsonb("site_facts").$type<Record<string, unknown>>(),
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
    /** The follow-up: the agents' draft of a short second note, and when and by whom a person sent
     *  one (person-only, like the statuses). The Clock home's Follow up list reads them. */
    draftFollowup: text("draft_followup"),
    /** A draft per follow-up step, stamped by Peek (lib/follow-up-drafts.ts). */
    followupDrafts: jsonb("followup_drafts").$type<FollowUpDrafts>(),
    followUpAt: date("follow_up_at", { mode: "string" }),
    followUpBy: text("follow_up_by").array(),
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
    index("leads_status").on(t.tenantId, t.emailStatus, t.whatsappStatus),
    index("leads_domain").on(t.tenantId, t.domain),
    index("leads_updated").on(t.tenantId, t.updatedAt),
    index("leads_rev").on(t.tenantId, t.rev),
  ],
).enableRLS();

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
    /** "person" (a Peek user, by userId) or "bot" (an agent or job, through an API key). */
    actorKind: text("actor_kind").notNull(),
    actorName: text("actor_name").notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    /** The API key the write came through, by name ("engine", "validator", "backfill"); null for a person. */
    via: text("via"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    sourceUrl: text("source_url"),
    /** "applied", or "refused" with the reason: person_wins, human_only, filled, research_first. */
    outcome: text("outcome").notNull().default("applied"),
    reason: text("reason"),
  },
  (t) => [index("lead_cells_lead").on(t.leadId, t.column, t.id), index("lead_cells_tenant").on(t.tenantId, t.id)],
).enableRLS();

/** A machine's key to the board API (the engine, the Validator, the backfill), stored as SHA-256 only. The key fixes the
 *  company; its scopes say what it may do: board:read, board:write, board:import (the backfill: an upsert that keeps
 *  Notion's values as they are). Minted with scripts/api-key.mjs into the engine's common-data/keys/peek-<name>.key. */
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  scopes: text("scopes").array().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}).enableRLS();

/** What each API key pulled, day by day (since the Neon free quota tripped on 2026-11-06): the
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
).enableRLS();

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
).enableRLS();

/** The Validator's flags on a lead (the Validator's flag_sync): one per rule, open or resolved; a flag
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
).enableRLS();

/**
 * The team's tasks (design: the engine's common-data/tasks-move-design.md), moved from Notion's "Tasks
 * Tracker" like the Leads board: written only through lib/tasks.ts, every change in `task_cells`, `rev` from its own
 * sequence. `assignees` keeps the names as given (Notion's people, or a Peek user's name); `projects` the Notion
 * relation ids the backfill copies; `checklist` the "Done when" items a person ticks. `standing` marks The CEO's
 * persistent send task: pinned at the top of the queue, never done.
 */
export const tasksRev = pgSequence("tasks_rev_seq");
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
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
  (t) => [index("tasks_rev").on(t.tenantId, t.rev), index("tasks_status").on(t.tenantId, t.status)],
).enableRLS();

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
).enableRLS();

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
).enableRLS();

/** The team's files (uploaded to be attached to the emails): PDFs, and PNG/JPG for logos, up to 25 MB, kept in Neon Object Storage (the bucket in neon.ts) under
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
    /** Which object store holds the bytes (Files moved from Neon to Supabase Storage): "neon",
     *  "supabase" or "local"; a file whose store is not the one in use reads "copy pending" until files-copy moves it. */
    store: text("store").notNull().default("neon"),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [index("files_tenant").on(t.tenantId, t.createdAt)],
).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
).enableRLS();

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
    // An agent's review of a bot's draft (the CEO reviews the Package Designer's drafts before the owner
    // prices and publishes): POST /v1/assets/packages/drafts/review stamps these; a person's draft and a published package
    // are never reviewed. The verdict is "approve" or "revise"; the note is short, masked text.
    reviewedBy: text("reviewed_by"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewVerdict: text("review_verdict"),
    reviewNote: text("review_note"),
    updatedBy: text("updated_by").notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asset_packages_tenant").on(t.tenantId, t.position)],
).enableRLS();

/** The Asset page's "What we have" sections (the Notion page as it was): a title and a body in the
 *  page's light markdown (### a toggle, "- " or "1. " a list item, two spaces a level deeper), in order. A "rates" section
 *  shows the rate card (asset_rates) under its body. */
/** Each change a key makes to one package (PATCH /v1/assets/packages/<id>): the field, before and after,
 *  who (the "by" it sent) and through which key. A person's edits on the page keep updated_by/at as before. */
export const assetPackageChanges = pgTable(
  "asset_package_changes",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    packageId: uuid("package_id").notNull(),
    field: text("field").notNull(),
    old: jsonb("old"),
    new: jsonb("new"),
    by: text("by").notNull().default(""),
    via: text("via"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("asset_package_changes_package").on(t.tenantId, t.packageId, t.id)],
).enableRLS();

/** Peek's own scheduled jobs: one line per run and company, with what it did -- the job log, and how a
 *  job knows its first run. */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    job: text("job").notNull(),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    count: integer("count").notNull().default(0),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
  },
  (t) => [index("job_runs_job").on(t.job, t.tenantId, t.at)],
).enableRLS();

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
).enableRLS();

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
).enableRLS();

/** Sample sites: the free one-page site the Site Builder agent drafts for a
 *  no-site lead. The agent sends only the copy (POST /v1/samples/drafts); lib/samples.ts renders the page from the
 *  lead's row and the trade template, deterministically, and the html is kept here (tens of KB). One open draft per
 *  lead: status "draft" or "changes_requested" (a person's note for the agent), then "approved" (by the owner or a
 *  manager) and "live" once published, or "taken_down". `version` counts the agent's drafts for the lead. */
export const samples = pgTable(
  "samples",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    template: text("template").notNull(),
    copy: jsonb("copy").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    html: text("html").notNull().default(""),
    status: text("status").notNull().default("draft"),
    version: integer("version").notNull().default(1),
    note: text("note").notNull().default(""),
    draftedBy: text("drafted_by").notNull().default(""),
    reviewedBy: text("reviewed_by").notNull().default(""),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    url: text("url").notNull().default(""),
    publishedAt: timestamp("published_at", { withTimezone: true }),   // when the Mac's publisher put it up; 30 days later it comes down
    // the production line: what the page was rendered from (facts) and what its copy was written from
    // (name, pain point, listing kind), so a lead write re-renders a facts change and the queue lists a copy change
    factsHash: text("facts_hash").notNull().default(""),
    copyHash: text("copy_hash").notNull().default(""),
    hold: boolean("hold").notNull().default(false),                    // a person's hold: never published, whatever its status
    frozenAt: timestamp("frozen_at", { withTimezone: true }),          // the lead answered (Replied or Meeting): no automatic rebuild
    changesNote: text("changes_note").notNull().default(""),           // a person's note on a frozen approved or live sample
    // the Site Builder's own page: kind "page" when html is the whole page it wrote (up to
    // 300 KB, published as it is; never re-rendered from a template), "template" for the older rendered ones; what this
    // version changed, in one line; and where each fact came from ([{fact, from}])
    kind: text("kind").notNull().default("template"),
    changes: text("changes").notNull().default(""),
    sources: jsonb("sources").$type<{ fact: string; from: string }[]>().notNull().default(sql`'[]'::jsonb`),
    // the page's style signature from the Site Builder ({palette, fonts, sections, headline}), so each page can differ
    signature: jsonb("signature").$type<Record<string, unknown>>(),
    notComplete: text("not_complete").notNull().default(""),           // Why this version arrived incomplete; it cannot be approved
    designReason: text("design_reason").notNull().default(""),         // the Site Builder's why: who it is for, palette, fonts, order, lead facts
    // the outside pictures copied into Peek's file bucket at Approve: [{src, path, key, type}] (the live page loads them from
    // its own assets/ folder, since listing and Instagram photo links expire)
    assets: jsonb("assets").$type<{ src: string; path: string; key: string; type: string }[]>().notNull().default(sql`'[]'::jsonb`),
    /** The sample's extra pages beside its main one (a gallery), each {path: "<name>/index.html", html}, at most
     *  3; checked like the main page, published at <slug>/<path>. */
    pages: jsonb("pages").$type<{ path: string; html: string }[]>().notNull().default(sql`'[]'::jsonb`),
    /** The sample's edited photos ({name, key, type, bytes, guest, dish, at, by}), uploaded by the helper with the
     *  engine's key; kept across drafts (lib/sample-photos.ts). A page uses one as photos/<name>. */
    photos: jsonb("photos").$type<{ name: string; key: string; type: string; bytes: number; guest: boolean; dish: string; at: string; by: string }[]>().notNull().default(sql`'[]'::jsonb`),
    /** The version a person (or Settings' auto-approve) approved last. It stays on the web while a newer version
     *  waits as a draft or sent back; null until one is approved. A new draft never changes it. */
    approvedVersion: integer("approved_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("samples_lead").on(t.tenantId, t.leadId), index("samples_status").on(t.tenantId, t.status)],
).enableRLS();

/** A sample the owner deleted: the audit line (who, when, its slug and business) and the marker that
 *  keeps the lead out of the Site Builder's queue and its drafts until someone reopens it (POST /v1/samples/reopen). */
export const sampleDeletions = pgTable(
  "sample_deletions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    sampleId: uuid("sample_id").notNull(),
    slug: text("slug").notNull().default(""),
    business: text("business").notNull().default(""),
    versions: integer("versions").notNull().default(0),
    deletedBy: text("deleted_by").notNull().default(""),
    deletedAt: timestamp("deleted_at", { withTimezone: true }).notNull().defaultNow(),
    reopenedBy: text("reopened_by"),
    reopenedAt: timestamp("reopened_at", { withTimezone: true }),
  },
  (t) => [index("sample_deletions_lead").on(t.tenantId, t.leadId)],
).enableRLS();

/** Each earlier version of a sample: the row in samples is always the current one, so every reader of
 *  samples stays one row per lead; a re-render or a new draft copies the version it replaces here first. */
export const sampleVersions = pgTable(
  "sample_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    sampleId: uuid("sample_id").notNull().references(() => samples.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    template: text("template").notNull(),
    copy: jsonb("copy").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    html: text("html").notNull().default(""),
    factsHash: text("facts_hash").notNull().default(""),
    status: text("status").notNull().default(""),
    madeBy: text("made_by").notNull().default(""),
    madeAt: timestamp("made_at", { withTimezone: true }).notNull(),
    kind: text("kind").notNull().default("template"),                  // as on samples
    changes: text("changes").notNull().default(""),
    sources: jsonb("sources").$type<{ fact: string; from: string }[]>().notNull().default(sql`'[]'::jsonb`),
    signature: jsonb("signature").$type<Record<string, unknown>>(),
    notComplete: text("not_complete").notNull().default(""),           // Why this version arrived incomplete; it cannot be approved
    designReason: text("design_reason").notNull().default(""),         // the Site Builder's why: who it is for, palette, fonts, order, lead
    pages: jsonb("pages").$type<{ path: string; html: string }[]>().notNull().default(sql`'[]'::jsonb`), // as on samples facts
    /** The pictures copied at this version's Approve, so an approved version can stay on the web from here */
    assets: jsonb("assets").$type<{ src: string; path: string; key: string; type: string }[]>().notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("sample_versions_sample").on(t.sampleId, t.version)],
).enableRLS();

/** A person's change request on a sample (a picture may be attached to each request): each its own record -- the words, up to three pictures (re-encoded, no metadata,
 *  private in the file bucket), who and when, the version it was made on, and the version that answered it. A request with
 *  a picture goes to the site helper (the page writer reads text only). */
export const sampleRequests = pgTable(
  "sample_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    sampleId: uuid("sample_id").notNull().references(() => samples.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    pictures: jsonb("pictures").$type<{ n: number; key: string; type: string; bytes: number }[]>().notNull().default(sql`'[]'::jsonb`),
    byName: text("by_name").notNull().default(""),
    byUser: uuid("by_user"),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    madeOnVersion: integer("made_on_version").notNull(),
    status: text("status").notNull().default("open"),                 // open | addressed (a round claims it, 889) | answered | withdrawn
    answeredVersion: integer("answered_version"),
    answeredAt: timestamp("answered_at", { withTimezone: true }),
  },
  (t) => [index("sample_requests_sample").on(t.sampleId, t.at)],
).enableRLS();

/** A person's rewrite of a Writer draft offered as the template for its group (the record agreed
 *  with the Validator). Peek opens one when a person answers its prompt after a save (opened_by "peek",
 *  decided there), the Validator's sweep opens the rest (opened_by "validator", status "open") and mirrors them into the
 *  owner's Decisions box; the first answer wins (a later one is refused with the current record). One row per edit:
 *  (lead, channel, the lead_cells row of the save). failed_rules are the Validator's (checked once it has run them). */
export const templateProposals = pgTable(
  "template_proposals",
  {
    id: text("id").primaryKey(), // "tpl-<group>-<channel>-<yyyymmddHHMM>[-<edit id>]"
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    group: text("group").notNull(), // the row's package, or "no package, no website" / "no package, own website"
    channel: text("channel").notNull(), // "email" | "whatsapp"
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    leadName: text("lead_name").notNull().default(""),
    editId: bigint("edit_id", { mode: "number" }).notNull(), // the lead_cells row of the person's save
    editedBy: text("edited_by").notNull().default(""),
    editedAt: timestamp("edited_at", { withTimezone: true }).notNull(),
    before: text("before").notNull().default(""),
    after: text("after").notNull().default(""),
    template: text("template").notNull().default(""),
    placeholders: jsonb("placeholders").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    failedRules: jsonb("failed_rules").$type<{ rule: string; detail: string }[]>().notNull().default(sql`'[]'::jsonb`),
    /** The earlier texts, oldest first, each time the template was uplifted (through the Validator's key):
     *  the text and placeholders before, when, the optional label of who wrote the new one, and the key it came through.
     *  `after` (the person's own words on their lead) never changes. */
    templateHistory: jsonb("template_history").$type<{ template: string; placeholders: string[]; at: string; by: string; via: string }[]>().notNull().default(sql`'[]'::jsonb`),
    checked: boolean("checked").notNull().default(false),
    count: integer("count").notNull().default(0),
    textKey: text("text_key").notNull(),
    status: text("status").notNull().default("open"), // open | approved | declined | one_off | replaced
    decidedBy: text("decided_by"),
    decidedWhere: text("decided_where"), // "decisions_box" | "peek"
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    openedBy: text("opened_by").notNull(), // "peek" | "validator"
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("template_proposals_edit").on(t.tenantId, t.leadId, t.channel, t.editId), index("template_proposals_status").on(t.tenantId, t.status, t.updatedAt)],
).enableRLS();

/** The sample link test: a lead's group, set once by the system when it first has a public link and has not been
 *  emailed, alternating by lead. "link_first" | "after_reply". */
export const leadSampleTests = pgTable(
  "lead_sample_tests",
  {
    leadId: uuid("lead_id").primaryKey().references(() => leads.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    variant: text("variant").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("lead_sample_tests_tenant").on(t.tenantId, t.variant)],
).enableRLS();

/** The send log: one row per lead and channel, following the board (lib/lead-sends.ts). Lead data only: it has no
 *  person column, on purpose. `result` is the lead's Result as it applies to this send; `source`: mark | already_sent | backfill. */
/** Each signed-in press with consequences, with a hash of its session and that session's sign-in time
 *  (lib/session-press.ts). Append-only; no page or /v1 route reads it. */
export const sessionPresses = pgTable(
  "session_presses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    rowKind: text("row_kind").notNull(),
    rowId: text("row_id").notNull(),
    sessionHash: text("session_hash"),
    sessionAt: timestamp("session_at", { withTimezone: true }),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("session_presses_row").on(t.tenantId, t.rowKind, t.rowId), index("session_presses_session").on(t.sessionHash, t.at)],
).enableRLS();

/** The owner's own downloads (Settings > Treasure Hunt): a disk image or an archive kept in the file store, one row per
 *  version. The SHA-256 is Peek's own, computed from the bytes it stored. The newest two versions of an item are kept. */
export const treasures = pgTable(
  "treasures",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    item: text("item").notNull(), // the item's key, from its name: a newer version of the same item replaces it on the page
    name: text("name").notNull(),
    version: text("version").notNull().default(""),
    about: text("about").notNull().default(""), // what it is, in one line
    howTo: text("how_to").notNull().default(""), // how to install it, free text
    fileName: text("file_name").notNull(),
    contentType: text("content_type").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    addedBy: text("added_by").notNull().default(""),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("treasures_item").on(t.tenantId, t.item, t.addedAt)],
).enableRLS();

/** An owner's or manager's close or correction of a member's forgotten clock. Append-only; the shift keeps the time. */
export const shiftEdits = pgTable(
  "shift_edits",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    shiftId: uuid("shift_id").notNull().references(() => shifts.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    action: text("action").notNull(), // "close" | "correct"
    oldEnd: timestamp("old_end", { withTimezone: true }),
    newEnd: timestamp("new_end", { withTimezone: true }).notNull(),
    byUser: uuid("by_user").references(() => users.id, { onDelete: "set null" }),
    byName: text("by_name").notNull(),
    byRole: text("by_role").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shift_edits_user").on(t.tenantId, t.userId, t.at), index("shift_edits_shift").on(t.shiftId, t.at)],
).enableRLS();

/** What a machine proposes for the owner's own press (lib/owner-asks.ts). `generation` goes up whenever the words or
 *  the place change, so no earlier approval can come back. */
export const ownerAsks = pgTable(
  "owner_asks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    subject: text("subject").notNull(),
    target: text("target").notNull(),
    title: text("title").notNull(),
    text: text("text").notNull(),
    channel: text("channel").notNull(),
    textHash: text("text_hash").notNull(),
    generation: integer("generation").notNull().default(1),
    filedBy: text("filed_by").notNull(),
    filedAt: timestamp("filed_at", { withTimezone: true }).notNull().defaultNow(),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("owner_asks_one").on(t.tenantId, t.kind, t.subject)],
).enableRLS();

/** A signed-in owner's press on one generation of an ask. Only the session route writes one. */
export const ownerAnswers = pgTable(
  "owner_answers",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    askId: uuid("ask_id").notNull().references(() => ownerAsks.id, { onDelete: "cascade" }),
    generation: integer("generation").notNull(),
    textHash: text("text_hash").notNull(),
    target: text("target").notNull(),
    byUser: uuid("by_user").references(() => users.id, { onDelete: "set null" }),
    byName: text("by_name").notNull(),
    byRole: text("by_role").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    withdrawnAt: timestamp("withdrawn_at", { withTimezone: true }),
    withdrawnBy: uuid("withdrawn_by").references(() => users.id, { onDelete: "set null" }),
    usedAt: timestamp("used_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("owner_answers_live").on(t.askId, t.generation).where(sql`withdrawn_at is null`), index("owner_answers_ask").on(t.askId, t.generation)],
).enableRLS();

/** A provider off for billing. A key may add one; only a signed-in owner clears it. */
export const billingBenches = pgTable(
  "billing_benches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    host: text("host").notNull(),
    itemId: text("item_id").notNull(),
    why: text("why").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    filedBy: text("filed_by").notNull(),
    filedAt: timestamp("filed_at", { withTimezone: true }).notNull().defaultNow(),
    clearedAt: timestamp("cleared_at", { withTimezone: true }),
    clearedBy: uuid("cleared_by").references(() => users.id, { onDelete: "set null" }),
    clearedName: text("cleared_name"),
    clearedRole: text("cleared_role"),
  },
  (t) => [uniqueIndex("billing_benches_one").on(t.tenantId, t.host, t.itemId)],
).enableRLS();

/** Each follow-up a person marked sent, at most three a lead. Peek never sends; the engine does not write this. */
export const leadFollowUps = pgTable(
  "lead_follow_ups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    step: integer("step").notNull(),
    channel: text("channel").notNull(), // "email" | "whatsapp"
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    byUser: uuid("by_user").references(() => users.id, { onDelete: "set null" }),
    byName: text("by_name").notNull(),
  },
  (t) => [uniqueIndex("lead_follow_ups_step").on(t.leadId, t.step), index("lead_follow_ups_tenant").on(t.tenantId, t.sentAt)],
).enableRLS();

export const leadSends = pgTable(
  "lead_sends",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(), // "email" | "whatsapp"
    variant: text("variant").notNull(), // "link_first" | "after_reply" | "no_sample" | "off_test"
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    result: text("result"),
    amountCents: integer("amount_cents"),
    linkSentAt: timestamp("link_sent_at", { withTimezone: true }),
    source: text("source").notNull().default("mark"),
  },
  (t) => [uniqueIndex("lead_sends_one").on(t.leadId, t.channel), index("lead_sends_tenant").on(t.tenantId, t.channel, t.variant)],
).enableRLS();

/** A Google Doc pasted into a lead keeps its formatting: the cleaned HTML of a long cell, with the hash of the plain
 *  text it belongs to. The cell stays the truth; once it changes, this copy no longer shows. Only the team's lead panel reads it. */
export const leadRichText = pgTable(
  "lead_rich_text",
  {
    leadId: uuid("lead_id").notNull().references(() => leads.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").notNull().references(() => tenants.id, { onDelete: "cascade" }),
    field: text("field").notNull(),
    html: text("html").notNull(),
    plainHash: text("plain_hash").notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.leadId, t.field] }), index("lead_rich_text_tenant").on(t.tenantId)],
).enableRLS();
