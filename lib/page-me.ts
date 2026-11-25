// For a page: signed in, and the current notice acknowledged; else off to sign-in or the welcome step.
import { redirect } from "next/navigation";
import { me, type Me } from "./auth";
import { withNext } from "./return-path";

/** For a page: signed in, and the current notice acknowledged; else off to sign-in or the welcome step. `from`, the
 *  page's own path, rides along as ?next= so the person lands back on it (a deep link a bot recorded, for one). */
export async function pageMe(from?: string): Promise<Me> {
  const who = await me();
  if (!who) redirect(withNext("/sign-in", from));
  if (!who.acked) redirect(withNext("/welcome", from));
  return who;
}
