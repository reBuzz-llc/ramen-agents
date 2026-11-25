// Which agents a team has, so a page fed by an agent the team does not run says so in one line instead of sitting
// empty. Peek learns the team's agents from the Validator's latest "tick" report on the Family page (POST
// /v1/family/report: its members list). With no such report Peek cannot tell, and no page says anything.
import { and, desc, eq } from "drizzle-orm";
import type { Db } from "./db";
import { familyReports } from "./db/schema";

/** The team's agents by lower-cased name, from the latest tick report; null when Peek cannot tell (no tick report, or one
 *  whose members list is missing or names nobody). */
export async function teamAgents(d: Db, tenantId: string): Promise<Set<string> | null> {
  const [row] = await d
    .select({ lines: familyReports.lines })
    .from(familyReports)
    .where(and(eq(familyReports.tenantId, tenantId), eq(familyReports.kind, "tick")))
    .orderBy(desc(familyReports.at))
    .limit(1);
  if (!row) return null;
  const members = (row.lines as { members?: unknown } | null)?.members;
  const names = Array.isArray(members) ? members.map((m) => (typeof (m as { name?: unknown })?.name === "string" ? (m as { name: string }).name.trim().toLowerCase() : "")).filter(Boolean) : [];
  return names.length ? new Set(names) : null;
}

export { missingAgent, missingLine } from "./agent-presence-text";
