// The bridge for a database made by the starter's older portal branch (up to mid-November). That branch had Peek's first
// 36 migrations (0000-0035, the same files) and then one of its own, 0036_drop_notion, dated 2026-11-16, which dropped
// the Notion tables and columns. Peek's own 0036 to 0043 are dated earlier than that, so Drizzle, which runs only the
// migrations dated after the last one applied, would skip them and then fail at 0044 for want of the samples table.
//
// So before the migrations run: when the portal's 0036 is the one recorded, put back, empty, what it dropped (the two
// tables, seven columns and two indexes, exactly as Peek's 0035 left them; Peek drops them itself later), and remove
// its record. Peek's chain then runs from its own 0036, in order. No row of the user's is touched. On any other
// database (Peek's own, a new one) it finds no such record and does nothing. Safe to run again.

/** The portal's own 0036: its file's SHA-256 (what Drizzle records as the hash) and its date (what it records as created_at). */
export const PORTAL_0036 = { hash: "ae10e91e6d6989c5ad495610eb1d20622b91bae6c166f3f16f36b7c14e82fb7f", createdAt: 1794844502789 };

export const BRIDGE_SQL = [
  `CREATE TABLE IF NOT EXISTS "board_rows" (
    "tenant_id" uuid NOT NULL,
    "page_id" text NOT NULL,
    "data" jsonb NOT NULL,
    "fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "board_rows_tenant_id_page_id_pk" PRIMARY KEY("tenant_id","page_id"),
    CONSTRAINT "board_rows_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action
  )`,
  `CREATE TABLE IF NOT EXISTS "notion_connections" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
    "tenant_id" uuid NOT NULL,
    "token_encrypted" text NOT NULL,
    "leads_data_source" text NOT NULL,
    "tasks_data_source" text,
    "leads_title" text,
    "tasks_title" text,
    "integration_name" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "notion_connections_tenant_id_unique" UNIQUE("tenant_id"),
    CONSTRAINT "notion_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action
  )`,
  `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "notion_page_id" text`,
  `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "notion_url" text`,
  `ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "notion_uid" text`,
  `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "notion_page_id" text`,
  `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "notion_url" text`,
  `ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "notion_uid" text`,
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notion_user_id" text`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "leads_notion_page" ON "leads" USING btree ("tenant_id","notion_page_id")`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "tasks_notion_page" ON "tasks" USING btree ("tenant_id","notion_page_id")`,
];

/** Bridges a portal database if it needs it. `query(text, params)` answers {rows}; the statements run in one transaction.
 *  Answers "bridged", "none" (not a portal database at its own 0036) or "new" (no migrations recorded yet). */
export async function bridgePortal(query) {
  const has = await query(`select to_regclass('drizzle.__drizzle_migrations') is not null as ok`);
  if (!has.rows[0]?.ok) return "new";
  const found = await query(`select id from drizzle.__drizzle_migrations where hash = $1 or created_at = $2`, [PORTAL_0036.hash, PORTAL_0036.createdAt]);
  if (!found.rows.length) return "none";
  await query("begin");
  try {
    for (const s of BRIDGE_SQL) await query(s);
    await query(`delete from drizzle.__drizzle_migrations where hash = $1 or created_at = $2`, [PORTAL_0036.hash, PORTAL_0036.createdAt]);
    await query("commit");
  } catch (err) {
    await query("rollback").catch(() => {});
    throw err;
  }
  return "bridged";
}
