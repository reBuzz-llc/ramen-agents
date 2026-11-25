import { NextResponse } from "next/server";
import { failed, keyed } from "@/lib/board-api";
import { references } from "@/lib/sample-references";

// GET /v1/samples/references (board:read): the owner's reference
// sites, read-only -- {references: [{sampleId, leadId, family, version, setAt, setBy}], updatedAt}. Each is pinned to the
// version it was marked on; the engine fetches that version's page with GET /v1/samples/<id>?v=<version> and works out its
// content profile by code. An empty list means no references: nothing changes for any draft.
export async function GET(req: Request) {
  const k = await keyed(req, "board:read");
  if ("res" in k) return k.res;
  try {
    const r = await references(k.d, k.key.tenantId);
    return NextResponse.json({ references: r.references.map(({ sampleId, leadId, family, version, setAt, setBy }) => ({ sampleId, leadId, family, version, setAt, setBy })), updatedAt: r.updatedAt });
  } catch (err) {
    return failed(err, "v1.samples.references");
  }
}
