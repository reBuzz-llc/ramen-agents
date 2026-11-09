// Daily send goals per person: more mail goes to spam when one address sends a
// lot, so each person sends at most a set number of first emails and WhatsApp messages a day (5 and 3 unless the owner
// changes them in Settings → Company). The pack fills only up to what is left today, and Mark sent beyond the goal is
// refused (a hard cap). Checking numbers is not a send and is never capped. The day is the company's local day
// (settings.timezone; the server's clock when unset).
//
// A send counts for the person who marked it, on the day they marked it: the lead's History step that set Email Sent (or
// WhatsApp msg sent), by them, today, on a lead still marked sent (an undo frees the slot). Leads → Mark already sent
// records sends made before, so its steps carry ALREADY_SENT_SOURCE and never count.
// Pure (the pack's client side imports it); the queries are in lib/send-goals-db.ts.
import type { TenantSettings } from "./db/schema";
import { WHATSAPP_SENT_MARK as WHATSAPP_SENT } from "./activity";

export const DEFAULT_EMAIL_GOAL = 5;
export const DEFAULT_WHATSAPP_GOAL = 3;
export const ALREADY_SENT_SOURCE = "peek:mark-already-sent";
const MAX_GOAL = 200;

export type Channel = "email" | "whatsapp";
export type Goals = { email: number; whatsapp: number };
export type Budget = { sent: number; goal: number; left: number };

/** The company's daily goals: the owner's numbers, else 5 emails and 3 WhatsApp messages. */
export function goalsOf(settings: TenantSettings | null | undefined): Goals {
  const ok = (n: unknown, d: number) => (typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= MAX_GOAL ? n : d);
  return { email: ok(settings?.sendGoals?.email, DEFAULT_EMAIL_GOAL), whatsapp: ok(settings?.sendGoals?.whatsapp, DEFAULT_WHATSAPP_GOAL) };
}

/** A goal from the Settings form: a whole number 0–200, else undefined (the default). */
export function goalFromForm(v: unknown): number | undefined {
  const t = String(v ?? "").trim();
  const n = Number(t);
  return t && Number.isInteger(n) && n >= 0 && n <= MAX_GOAL ? n : undefined;
}

/** True for a time zone name the runtime knows ("Europe/Berlin", "UTC"). */
export function validTimeZone(tz: unknown): boolean {
  if (typeof tz !== "string" || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** How far `tz`'s wall clock is ahead of UTC at `at`, in ms. */
function offsetMs(at: Date, tz: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(at.getTime() / 1000) * 1000;
}

/** The company's day `now` falls in, as YYYY-MM-DD. */
export function dayIn(now: Date, tz?: string | null): string {
  if (!tz || !validTimeZone(tz)) return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** 00:00 of the company's day `now` falls in (the server's local midnight when no valid time zone is set). */
export function dayStartIn(now: Date, tz?: string | null): Date {
  if (!tz || !validTimeZone(tz)) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  const [y, m, d] = dayIn(now, tz).split("-").map(Number);
  const guess = Date.UTC(y, m - 1, d);
  // twice, so a midnight next to a daylight-saving change lands right
  let at = guess - offsetMs(new Date(guess), tz);
  at = guess - offsetMs(new Date(at), tz);
  return new Date(at);
}

/** Working days (Monday to Friday) from `from` up to and including the day of `now`. */
export function workingDaysSoFar(from: Date, now: Date): number {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  let n = 0;
  while (d.getTime() <= now.getTime()) {
    if (d.getDay() !== 0 && d.getDay() !== 6) n++;
    d.setDate(d.getDate() + 1);
  }
  return n;
}

/** The line shown when the day's goal is met; Mark sent beyond it is refused with it. */
export function doneLine(goal: number): string {
  return `Today's ${goal} ${goal === 1 ? "is" : "are"} done; more tomorrow.`;
}

export const budgetOf = (sent: number, goal: number): Budget => ({ sent, goal, left: Math.max(0, goal - sent) });

/** Which sends a person's edit makes: Email Sent and WhatsApp msg sent (the drawer's steps, the queue's "I sent it"). */
export function sendsIn(fields: Record<string, unknown>): Channel[] {
  const out: Channel[] = [];
  const status = typeof fields.status === "string" ? fields.status : null;
  if (fields.email_status === "Email Sent" || status === "Email Sent") out.push("email");
  if (fields.whatsapp_status === WHATSAPP_SENT || status === WHATSAPP_SENT) out.push("whatsapp");
  return out;
}
