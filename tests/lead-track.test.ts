import { describe, expect, it } from "vitest";
import { leadTracks, type Track } from "@/lib/lead-track";
import { emailSteps, whatsappSteps } from "@/lib/lead-workflow";

const NOW = new Date("2026-11-23T10:00:00Z");
const line = (t: Track) => t.nodes.map((n) => `${n.label}:${n.state}`);
const email = (l: Record<string, unknown>) => leadTracks(l, NOW)[0];
const wa = (l: Record<string, unknown>) => leadTracks(l, NOW)[1];

describe("the email line", () => {
  it("a new lead: only Ready can be pressed", () => expect(line(email({}))).toEqual(["Ready:next", "Sent:later", "Replied:later", "Meeting:later", "Won:later"]));

  it("ready: Sent is next", () => expect(line(email({ email_status: "Ready to Send Email" }))).toEqual(["Ready:current", "Sent:next", "Replied:later", "Meeting:later", "Won:later"]));

  it("sent: Replied or Won, with Lost and Bounced in the menu", () => {
    const t = email({ email_status: "Email Sent", result: "Emailed" });
    expect(line(t)).toEqual(["Ready:done", "Sent:current", "Replied:next", "Meeting:later", "Won:next"]);
    expect(t.more.map((s) => s.label)).toEqual(["Lost", "Bounced"]);
    expect(t.note).toBeNull();
  });

  it("replied: Meeting and Won", () => {
    const t = email({ email_status: "Email Sent", result: "Replied" });
    expect(line(t)).toEqual(["Ready:done", "Sent:done", "Replied:current", "Meeting:next", "Won:next"]);
    expect(t.more.map((s) => s.label)).toEqual(["Lost"]);
  });

  it("won: everything before counts as reached, as on the scoreboard, and nothing is left to press", () => {
    const t = email({ email_status: "Email Sent", result: "Client" });
    expect(line(t)).toEqual(["Ready:done", "Sent:done", "Replied:done", "Meeting:done", "Won:current"]);
    expect(t.more).toEqual([]);
  });

  it.each([["Not interested", "Lost"], ["Bounced", "Bounced"]])("%s ends the line", (result, label) => {
    const t = email({ email_status: "Email Sent", result });
    expect(line(t)).toEqual(["Ready:done", "Sent:current", `${label}:stopped`]);
    expect(t.more).toEqual([]);
    expect(t.clears.map((c) => c.field)).toEqual(["result", "email_status"]);
  });

  it("a reply with no email sent does not claim an email", () => expect(line(email({ result: "Replied" })).slice(0, 3)).toEqual(["Ready:next", "Sent:later", "Replied:current"]));

  it("shows a value it cannot place", () => {
    expect(email({ email_status: "Something old" }).note).toBe("Something old");
    expect(email({ result: "Emailed" }).note).toBe("Emailed");
    expect(email({ result: "Not contacted" }).note).toBeNull();
  });

  it("offers clearing only what is set", () => {
    expect(email({}).clears).toEqual([]);
    expect(email({ email_status: "Ready to Send Email" }).clears.map((c) => c.label)).toEqual(["Clear email status"]);
  });
});

describe("the WhatsApp line", () => {
  it("is there only with a number or a status", () => {
    expect(leadTracks({}, NOW)).toHaveLength(1);
    expect(leadTracks({ whatsapp: "+1 555" }, NOW)).toHaveLength(2);
    expect(leadTracks({ whatsapp_status: "WhatsApp Verified" }, NOW)).toHaveLength(2);
  });

  it("walks Asked, Verified, Message sent", () => {
    expect(line(wa({ whatsapp: "x" }))).toEqual(["Asked:next", "Verified:next", "Message sent:later"]);
    const asked = wa({ whatsapp: "x", whatsapp_status: "Waiting response for WhatsApp verification" });
    expect(line(asked)).toEqual(["Asked:current", "Verified:next", "Message sent:later"]);
    expect(asked.more.map((s) => s.label)).toEqual(["False number"]);
    expect(line(wa({ whatsapp: "x", whatsapp_status: "WhatsApp Verified" }))).toEqual(["Asked:done", "Verified:current", "Message sent:next"]);
    expect(line(wa({ whatsapp: "x", whatsapp_status: "WhatsApp msg sent" }))).toEqual(["Asked:done", "Verified:done", "Message sent:current"]);
  });

  it("a false number ends the line", () => expect(line(wa({ whatsapp: "x", whatsapp_status: "False Whatsapp Number" }))).toEqual(["Asked:current", "False number:stopped"]));
});

describe("no step is lost or changed", () => {
  const cases: Record<string, unknown>[] = [{}, { email_status: "Ready to Send Email" }, ...["Emailed", "Replied", "Meeting", "Client", "Not interested", "Bounced"].map((result) => ({ email_status: "Email Sent", result })), ...[null, "Waiting response for WhatsApp verification", "WhatsApp Verified", "WhatsApp msg sent", "False Whatsapp Number"].map((whatsapp_status) => ({ whatsapp: "x", whatsapp_status }))];

  it.each(cases.map((c) => [JSON.stringify(c), c] as const))("%s: every workflow step is on the line or in the menu, with the same writes", (_n, l) => {
    const offered = [...emailSteps(l, NOW), ...whatsappSteps(l)];
    const shown = leadTracks(l, NOW).flatMap((t) => [...t.nodes.flatMap((n) => (n.step ? [n.step] : [])), ...t.more]);
    expect(shown.map((s) => s.key).sort()).toEqual(offered.map((s) => s.key).sort());
    for (const s of shown) expect(s.fields).toEqual(offered.find((o) => o.key === s.key)!.fields);
  });
});
