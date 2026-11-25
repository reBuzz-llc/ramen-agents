// Every table has row level security on, declared in the schema (drizzle writes it into the
// migrations), as the 32 tables made before 11-06 had it outside the code and the seven made since did not. No policies
// and no FORCE: Peek's role bypasses it, and nothing else may reach a table. A new table without .enableRLS() fails here.
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";

const tables = (Object.values(schema) as unknown[]).filter((v): v is PgTable => is(v, PgTable));

describe("row level security on every table (649)", () => {
  it("every table in the schema declares it", () => {
    expect(tables.length).toBeGreaterThanOrEqual(39);
    expect(tables.filter((t) => !getTableConfig(t).enableRLS).map((t) => getTableConfig(t).name)).toEqual([]);
  });
  it("the migrations enable it on every table, and add no policy and no FORCE", () => {
    const dir = path.join(__dirname, "..", "drizzle");
    const sql = readdirSync(dir).filter((f) => f.endsWith(".sql")).map((f) => readFileSync(path.join(dir, f), "utf8")).join("\n");
    for (const t of tables) expect(sql, getTableConfig(t).name).toContain(`ALTER TABLE "${getTableConfig(t).name}" ENABLE ROW LEVEL SECURITY`);
    expect(sql).not.toMatch(/CREATE POLICY|FORCE ROW LEVEL SECURITY/i);
  });
});
