import { originOf } from "@/lib/google-signin";
import { NextResponse } from "next/server";
import { me } from "@/lib/auth";
import { db } from "@/lib/db";
import { acknowledge } from "@/lib/notice";
import { safeNext, withNext } from "@/lib/return-path";
import { sameOrigin } from "@/lib/same-origin";

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const who = await me();
  if (!who) return NextResponse.redirect(new URL("/sign-in", originOf(req)), 303);
  const form = await req.formData();
  const next = safeNext(form.get("next"));
  if (form.get("ok") !== "on") return NextResponse.redirect(new URL(withNext("/welcome", next), originOf(req)), 303);
  await acknowledge(await db(), who.tenantId, who.userId);
  return NextResponse.redirect(new URL(next ?? "/", originOf(req)), 303);
}
