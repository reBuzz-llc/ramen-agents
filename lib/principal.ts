// The signed-in person, their company and whether they acknowledged the current notice, each in ONE query. Kept apart
// from auth.ts (which reads cookies) so tests can count the queries.
import { and, eq, gt, type SQL } from "drizzle-orm";
import { sha256 } from "./crypto";
import type { Db } from "./db";
import { acknowledgments, authSessions, tenants, users, type TenantSettings } from "./db/schema";
import { NOTICE_VERSION } from "./notice";
import type { Role } from "./roles";

export type Me = {
  userId: string;
  tenantId: string;
  tenantName: string;
  email: string;
  name: string;
  role: Role;
  notionUserId: string | null;
  settings: TenantSettings;
  /** The current notice acknowledged. */
  acked: boolean;
  /** When they first signed in; null until then (lib/team.ts marks it). */
  firstSignedInAt: Date | null;
};

// The signed-in person, their company and whether they acknowledged the current notice, in ONE query: the database is
// a long round trip away (Neon us-east-2 from the team, ~285 ms), so every page pays for each query it runs in a row.
async function principal(db: Db, where: SQL, viaSession = false): Promise<Me | null> {
  const q = db
    .select({
      userId: users.id,
      tenantId: users.tenantId,
      email: users.email,
      name: users.name,
      role: users.role,
      active: users.active,
      notionUserId: users.notionUserId,
      firstSignedInAt: users.firstSignedInAt,
      tenantName: tenants.name,
      settings: tenants.settings,
      ackId: acknowledgments.id,
    })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .leftJoin(acknowledgments, and(eq(acknowledgments.userId, users.id), eq(acknowledgments.noticeVersion, NOTICE_VERSION)));
  const [row] = await (viaSession ? q.innerJoin(authSessions, eq(authSessions.userId, users.id)) : q).where(where).limit(1);
  if (!row || !row.active) return null;
  const { active: _active, ackId, ...me } = row;
  void _active;
  return { ...me, settings: me.settings ?? {}, acked: !!ackId };
}

/** The users row behind a Neon Auth email, with company and notice state: one query. */
export const principalByEmail = (db: Db, email: string) => principal(db, eq(users.email, email.toLowerCase()));

/** The person behind a development session cookie: one query. */
export async function sessionUser(db: Db, token: string | undefined): Promise<Me | null> {
  if (!token) return null;
  return principal(db, and(eq(authSessions.idHash, sha256(token)), gt(authSessions.expiresAt, new Date()))!, true);
}
