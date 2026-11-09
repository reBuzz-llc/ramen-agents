// Reading and saving a person's own drawer view (users.view_prefs); the rules are in lib/view-prefs.ts.
import { and, eq } from "drizzle-orm";
import type { Db } from "./db";
import { users } from "./db/schema";
import { viewOf, type ViewPrefs } from "./view-prefs";

export async function getViewPrefs(db: Db, tenantId: string, userId: string): Promise<ViewPrefs> {
  const [u] = await db.select({ v: users.viewPrefs }).from(users).where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
  return viewOf(u?.v);
}

/** Save a person's own view (a part sent is merged into what is kept); answers the view as stored. */
export async function setViewPrefs(db: Db, tenantId: string, userId: string, patch: Partial<Record<keyof ViewPrefs, unknown>>): Promise<ViewPrefs> {
  const cur = await getViewPrefs(db, tenantId, userId);
  const next = viewOf({ ...cur, ...patch });
  const stored = { show_empty: next.show_empty, field_order: next.field_order, hidden_fields: next.hidden_fields };
  await db.update(users).set({ viewPrefs: stored }).where(and(eq(users.tenantId, tenantId), eq(users.id, userId)));
  return next;
}
