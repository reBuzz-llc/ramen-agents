import { failed, keyed, metered } from "@/lib/board-api";
import { followUpPlan } from "@/lib/follow-up";

// GET /v1/follow-ups (board:read): each sent lead with no answer and a follow-up
// left: {rows: [{leadId, step, dueAt, due, channel, draft: "none"|"ready"|"person"|"skip"|"held"}]}, soonest first, so the Writer
// can draft a step before it is due. A lead on hold is not listed. No text and no names. The drafts are written through the lead's
// own route as followup_drafts: {"<step>": {text, channel}} or {"<step>": {skip}}; a step a person wrote comes back refused.
export async function GET(req: Request) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  try {
    return await metered(k.d, k.key, { rows: await followUpPlan(k.d, k.key.tenantId) });
  } catch (err) {
    return failed(err, "v1.follow-ups");
  }
}
