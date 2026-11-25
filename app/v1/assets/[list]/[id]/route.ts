import { NextResponse } from "next/server";
import { keyPatchPackage, packageJson } from "@/lib/assets";
import { body, fail, failed, keyed } from "@/lib/board-api";

// PATCH /v1/assets/packages/<id> {fields: {email?, price?, name?}, by, since?} (board:write):
// one package, only the fields given, each change kept in asset_package_changes; `since` (its updated_at as read)
// refuses a stale write with 409. A key never changes a published package's name or price (405).
export async function PATCH(req: Request, ctx: { params: Promise<{ list: string; id: string }> }) {
  const { list, id } = await ctx.params;
  if (list !== "packages") return fail(404, "not_found", "only a package is changed one at a time: /v1/assets/packages/<id>");
  const k = await keyed(req, "board:write");
  if ("res" in k) return k.res;
  const b = await body(req);
  if (!b) return fail(400, "bad_request", "send {fields: {email?, price?, name?}, by}");
  const by = typeof b.by === "string" && b.by.trim() ? b.by.trim() : k.key.name;
  try {
    const r = await keyPatchPackage(k.d, k.key.tenantId, id, b.fields, by, k.key.name, typeof b.since === "string" ? b.since : undefined);
    if (!r.ok) return fail(r.status, r.status === 409 ? "conflict" : r.status === 404 ? "not_found" : r.status === 405 ? "method_not_allowed" : "bad_request", r.message);
    return NextResponse.json({ package: packageJson(r.package) });
  } catch (err) {
    return failed(err, "v1.assets.package");
  }
}
