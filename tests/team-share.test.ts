import { describe, expect, it } from "vitest";
import { mask, recentBullets, shareText, type ShareChange } from "@/lib/team-share";

// local times, so the test reads the same in any time zone
const at = (d: number, h: number, m = 0) => new Date(2026, 10, d, h, m).toISOString();
const now = new Date(2026, 10, 10, 16, 0);
const ch = (column: string, value: unknown, who: string, when: string, o: Partial<ShareChange> = {}): ShareChange => ({ column, old: null, new: value, actor: { kind: "person", name: who }, at: when, outcome: "applied", ...o });

describe("Copy for WhatsApp", () => {
  it("one bullet per save, newest first: steps by what they mean, edits by the cell", () => {
    const h = [
      ch("draft_email", "Hi Ana, call me on +1 718 555 0100", "Jasmine", at(10, 14, 10)),
      ch("email_status", "Email Sent", "Sampada", at(9, 11)),
      ch("sent_by", ["Sampada"], "Sampada", at(9, 11)),
      ch("sent_at", "2026-11-09", "Sampada", at(9, 11)),
      ch("result", "Meeting", "Ann", at(6, 9)),
      ch("result_date", "2026-11-06", "Ann", at(6, 9)),
      ch("notes", null, "Ann", at(5, 9), { old: "x" }),
    ];
    expect(recentBullets(h, now)).toEqual([
      "• Jasmine set Draft email (today 14:10)",
      "• Sampada marked Email sent (yesterday)",
      "• Ann set Result to Meeting (6 Nov)",
      "• Ann cleared Notes (5 Nov)",
    ]);
  });
  it("people only, applied only, seven days back, five at most", () => {
    const h = [
      ch("notes", "a", "Bot", at(10, 9), { actor: { kind: "bot", name: "Lead Enricher" } }),
      ch("notes", "b", "Ann", at(10, 9), { outcome: "refused" }),
      ch("notes", "c", "Ann", at(2, 9)), // eight days back
      ...[1, 2, 3, 4, 5, 6].map((i) => ch("phone", "x", "Olu", at(10, i))),
    ];
    const b = recentBullets(h, now);
    expect(b).toHaveLength(5);
    expect(b[0]).toBe("• Olu set Phone (today 06:00)");
    expect(b.join()).not.toContain("Ann");
  });
  it("the whole message: business, link, changes; none yet said so; no addresses or numbers", () => {
    const url = "https://peek.example/leads?lead=2e7e6382-5a2b-4e27-90aa-36c289c67c5b";
    expect(shareText({ business: "Luna Salon", url, history: [], now })).toBe(`Luna Salon\n${url}\n\nRecent changes:\n• no changes by the team yet`);
    const t = shareText({ business: "Luna Salon", url, history: [ch("business_email", "ana@luna.example", "ana@luna.example", at(10, 9))], now });
    expect(t).not.toMatch(/@luna|ana@/);
    expect(t).toContain("• [email] set Business email (today 09:00)");
    expect(mask("call +1 (718) 555-0100 or 718.555.0100, write hi@luna.example")).toBe("call [number] or [number], write [email]");
    expect(mask("Open 9 to 5, 2 shops")).toBe("Open 9 to 5, 2 shops");
  });
});
