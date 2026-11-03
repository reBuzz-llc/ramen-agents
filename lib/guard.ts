// One check for every route: signed in, the current notice acknowledged, and allowed this action by role.
import { NextResponse } from "next/server";
import { me, type Me } from "./auth";
import { can, type Action } from "./roles";

export async function guard(action: Action): Promise<{ who: Me } | { res: NextResponse }> {
  const who = await me();
  if (!who) return { res: NextResponse.json({ error: "sign in first" }, { status: 401 }) };
  // Nothing is recorded for a person who has not acknowledged the current notice.
  if (!who.acked) return { res: NextResponse.json({ error: "acknowledge the notice first (/welcome)" }, { status: 403 }) };
  if (!can(who.role, action)) return { res: NextResponse.json({ error: "your role cannot do that" }, { status: 403 }) };
  return { who };
}
