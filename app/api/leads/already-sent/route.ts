import { NextResponse } from "next/server";
import { boardLite, MARKS, markSent, matchEntries, MAX_ENTRIES, parsePaste, prevented, type MarkChoice } from "@/lib/already-sent";
import { db } from "@/lib/db";
import { publicReason } from "@/lib/errors";
import { guard } from "@/lib/guard";
import { sendNext } from "@/lib/send-next";
import { sameOrigin } from "@/lib/same-origin";
import { displayName } from "@/lib/display-name";

// Leads → Mark already sent, owner and manager. POST {text, mark, confirm}, mark one of email_sent,
// whatsapp_sent, whatsapp_verified, ready_email or per_line (the status named on each line):
// confirm false answers the preview (matched, not found, ambiguous, and what Send next stops offering); confirm true
// matches the same paste again and marks the matched leads sent as the signed-in person. The paste is never stored.
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const g = await guard("leads.import");
  if ("res" in g) return g.res;
  const b = (await req.json().catch(() => null)) as { text?: unknown; mark?: unknown; confirm?: unknown } | null;
  const mark = typeof b?.mark === "string" && (b.mark === "per_line" || b.mark in MARKS) ? (b.mark as MarkChoice) : null;
  if (!b || typeof b.text !== "string" || !mark) return NextResponse.json({ ok: false, error: `send {text, mark: ${[...Object.keys(MARKS), "per_line"].join(", ")}}` }, { status: 400 });
  if (b.text.length > 2_000_000) return NextResponse.json({ ok: false, error: "that paste is too long: 2 MB at most" }, { status: 400 });
  const entries = parsePaste(b.text);
  if (!entries.length) return NextResponse.json({ ok: false, error: "no lead id, email address or phone number in that paste" }, { status: 400 });
  try {
    const d = await db();
    const preview = matchEntries(entries, await boardLite(d, g.who.tenantId), mark);
    if (b.confirm !== true) {
      const next = await sendNext(d, g.who.tenantId);
      return NextResponse.json({
        ok: true,
        preview,
        prevented: prevented(
          preview,
          next.rows.map((r) => r.id),
        ),
        capped: entries.length >= MAX_ENTRIES,
      });
    }
    const done = await markSent(d, g.who.tenantId, preview, { kind: "person", name: displayName(g.who.name, g.who.email), userId: g.who.userId });
    return NextResponse.json({ ok: true, ...done });
  } catch (err) {
    return NextResponse.json({ ok: false, error: publicReason(err, "leads.already-sent") }, { status: 500 });
  }
}
