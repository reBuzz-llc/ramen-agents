// The board API's contract fixtures (docs/design/board-api.md, "Contract tests"): request/response pairs that both this
// server and macBot1's PeekClient replay. This test keeps the set whole: every operation and every error code the design
// names has a case, every case is well formed, and no fixture carries a real email domain or a key that looks real.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type Case = { name: string; operation: string; request: { method: string; path: string; headers: Record<string, string> }; response: { status: number; body: unknown } };
const DIR = path.join(process.cwd(), "tests", "contract");
const files = readdirSync(DIR).filter((f) => f.endsWith(".json"));
const cases: Case[] = files.flatMap((f) => (JSON.parse(readFileSync(path.join(DIR, f), "utf8")) as { cases: Case[] }).cases);

const OPERATIONS = ["schema()", "find_row(title)", "read_page(id)", "create_row", "update_row", "update_row (clear)", "rows_waiting", "rows_drafted",
  "replace_section", "append_line", "full sweep", "quick look", "filtered query", "user(id)", "change feed"];
const ERRORS = ["forbidden_column", "filled", "not_an_option", "refused_value", "needs_contact_person", "duplicate_row", "missing_scope",
  "not_found", "unauthorized", "rate_limited", "bad_query", "too_large", "method_not_allowed"];

describe("board API contract fixtures", () => {
  it("cover every operation and every error code", () => {
    const ops = new Set(cases.map((c) => c.operation));
    expect(OPERATIONS.filter((o) => !ops.has(o))).toEqual([]);
    const codes = new Set(cases.map((c) => (c.response.body as { error?: { code: string } })?.error?.code).filter(Boolean));
    expect(ERRORS.filter((e) => !codes.has(e))).toEqual([]);
  });
  it("every case is well formed: a name, a /v1 path, a status, and an error body exactly when the status is an error", () => {
    for (const c of cases) {
      expect(c.name, c.name).toBeTruthy();
      expect(c.request.path.startsWith("/v1/"), c.name).toBe(true);
      expect(["GET", "POST", "PATCH", "PUT", "DELETE"]).toContain(c.request.method);
      const isError = c.response.status >= 400;
      expect(Boolean((c.response.body as { error?: unknown })?.error), c.name).toBe(isError);
    }
  });
  it("names and keys are made up", () => {
    const text = files.map((f) => readFileSync(path.join(DIR, f), "utf8")).join("\n");
    expect(text).not.toMatch(/@(?!acme|joespizzanyc)[a-z0-9-]+\.(com|net|org|io)\b/);
    expect(text).not.toMatch(/Bearer (?!peek_test_)\w{8,}/);
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/g)) {
      expect(m[1].endsWith(".example") || ["www.linkedin.com", "wa.me"].includes(m[1]), m[1]).toBe(true);
    }
  });
});
