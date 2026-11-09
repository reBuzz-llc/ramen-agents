import { describe, expect, it } from "vitest";
import { activityOf, shortDate, WHATSAPP_SENT_MARK } from "@/lib/activity";
import { ACTIVITY_FIELDS, DRAWER_ORDER } from "@/lib/lead-workflow";
import { WHATSAPP_SENT } from "@/lib/leads";
import { DEFAULT_HIDDEN, viewOf } from "@/lib/view-prefs";

const now = new Date("2026-11-10T12:00:00Z");

describe("the drawer's Activity strip", () => {
  it("says each record as one short phrase", () => {
    const lead = { email_check: "valid", email_status: "Email Sent", whatsapp_status: null, sent_by: ["Jasmine"], sent_at: "2026-11-10T09:30:00Z", follow_up_by: ["Jasmine"], follow_up_at: "2026-11-14", result: "Meeting", result_date: "2026-11-17" };
    const history = [
      { column: "email_check", at: "2026-11-08T10:00:00Z", outcome: "applied" },
      { column: "email_check", at: "2026-11-09T10:00:00Z", outcome: "applied" },
    ];
    expect(activityOf(lead, history, "Taken by Ann", now).map((a) => a.text)).toEqual([
      "Email check: valid, 9 Nov",
      "Email sent by Jasmine, 10 Nov",
      "Follow-up by Jasmine, 14 Nov",
      "Result: Meeting, 17 Nov",
      "Taken by Ann",
    ]);
  });
  it("names the channel, says nothing for a lead not worked yet, and shows another year", () => {
    expect(activityOf({ whatsapp_status: WHATSAPP_SENT_MARK, sent_by: ["Ann", "Olu"], sent_at: "2026-11-03" }, [], null, now)[0].text).toBe("WhatsApp sent by Ann, Olu, 3 Nov");
    expect(activityOf({ email_status: "Email Sent", whatsapp_status: WHATSAPP_SENT_MARK, sent_by: ["Ann"] }, [], null, now)[0].text).toBe("Email and WhatsApp sent by Ann");
    expect(activityOf({ business: "Luna" }, [], null, now)).toEqual([]);
    expect(shortDate("2025-12-24", now)).toBe("24 Dec 2025");
    expect(WHATSAPP_SENT_MARK).toBe(WHATSAPP_SENT);
  });
  it("takes the workflow's records out of the drawer's fields and My view; the agents' proof fields start hidden", () => {
    for (const k of ACTIVITY_FIELDS) expect(DRAWER_ORDER).not.toContain(k);
    expect(viewOf({ field_order: ["result", "notes"] }).field_order).toEqual(["notes"]);
    expect(viewOf({}).hidden_fields).toEqual(DEFAULT_HIDDEN);
    for (const k of ["tools_on_site", "site_health", "source_pages", "evidence", "found_by", "founder_linkedin", "linkedin_via", "listing_evidence", "notion_uid"]) expect(DEFAULT_HIDDEN).toContain(k);
  });
});
