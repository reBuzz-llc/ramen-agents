import { latest, listSections, sectionJson } from "@/lib/assets";
import { fail, keyed, metered } from "@/lib/board-api";

// The company text (what the Notion "What we have" page held, now the Asset page's sections), for
// the family's machines: GET with any board:read key, {sections: [{id, position, title, kind, body, updated_at,
// updated_by}], updated_at}, in the page's order; the same list as /v1/assets/sections. People edit it on the page only.
export async function GET(req: Request) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  const rows = await listSections(k.d, k.key.tenantId);
  return metered(k.d, k.key, { sections: rows.map(sectionJson), updated_at: latest(rows) });
}

export function PUT() {
  return fail(405, "person_only", "the company sections are edited by people on the Asset page; a key reads them");
}
