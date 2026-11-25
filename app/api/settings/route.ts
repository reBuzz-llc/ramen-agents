import { originOf } from "@/lib/google-signin";
import { NextResponse } from "next/server";
import { cadenceFor, CADENCES, entryAt, ROUNDINGS, withChange } from "@/lib/cadence";
import { addProject, mergeProjects, projectsOf, renameProject, setProjectActive, setProjectCadence } from "@/lib/projects";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { guard } from "@/lib/guard";
import { can, canSetRole, type Role } from "@/lib/roles";
import { sameOrigin } from "@/lib/same-origin";
import { settingsOf, updateSettings } from "@/lib/tenants";
import { approvedWeeks, rateHistory, removeRate, setRate } from "@/lib/member-rates";
import { sectionOf } from "@/lib/settings-nav";
import { addDays, canSetRate, dayOf, money, rateLocks, rateOn, rateToWrite } from "@/lib/rates";
import { displayName } from "@/lib/display-name";
import { withOffBoard } from "@/lib/team-board";
import { goalFromForm, goalsOf, validTimeZone } from "@/lib/send-goals";
import { worldBase } from "@/lib/world-share";

// Back to the page the form was on: its Settings page (lib/settings-nav.ts sectionOf), or the Clock page's "Manage
// projects" (a form there sends return=/). Kept per request, never in a module variable shared by requests running at once.
const returns = new WeakMap<Request, string>();
const back = (req: Request, msg: string) => NextResponse.redirect(new URL(`${returns.get(req) ?? "/settings"}?msg=${encodeURIComponent(msg)}`, originOf(req)), 303);
const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").trim());
  return String(v ?? "").trim() && Number.isFinite(n) && n >= 0 ? Math.round(n) : undefined;
};

// One form endpoint for Settings; each action checks its own role.
export async function POST(req: Request) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const form = await req.formData();
  const action = String(form.get("action") ?? "");
  returns.set(req, form.get("return") === "/" ? "/" : `/settings/${sectionOf(action)}`);
  const d = await db();

  if (action === "keyResults") {
    const g = await guard("settings.keyResults");
    if ("res" in g) return g.res;
    const s = await settingsOf(d, g.who.tenantId);
    s.keyResults = { sent: num(form.get("sent")), replies: num(form.get("replies")), meetings: num(form.get("meetings")) };
    await updateSettings(d, g.who.tenantId, () => ({ keyResults: s.keyResults }));
    return back(req, "This week's key results saved.");
  }
  if (action === "sendGoals") {
    // daily send goals per person and the time zone their day starts in: the owner's
    const g = await guard("settings.rates");
    if ("res" in g) return g.res;
    const tz = String(form.get("timezone") ?? "").trim();
    if (tz && !validTimeZone(tz)) return back(req, `"${tz.slice(0, 60)}" is not a time zone name: pick one from the list, like Europe/Berlin or UTC.`);
    const s = await settingsOf(d, g.who.tenantId);
    const before = goalsOf(s);
    const next = { email: goalFromForm(form.get("daily_email_goal")), whatsapp: goalFromForm(form.get("daily_whatsapp_goal")) };
    const after = goalsOf({ sendGoals: next });
    // a change of the numbers (not a re-save) shows each person a banner once
    const changed = before.email !== after.email || before.whatsapp !== after.whatsapp;
    s.sendGoals = { ...next, changedAt: changed ? new Date().toISOString() : s.sendGoals?.changedAt };
    s.timezone = tz || undefined;
    await updateSettings(d, g.who.tenantId, () => ({ sendGoals: s.sendGoals, timezone: s.timezone }));
    return back(req, "Daily send goals saved. They apply from the next Fill my pack or Mark sent.");
  }
  if (action === "worldUrl") {
    // the live world's address on the Family page: the owner's
    const g = await guard("settings.rates");
    if ("res" in g) return g.res;
    const raw = String(form.get("world_url") ?? "").trim();
    const base = worldBase(raw);
    if (raw && !base) return back(req, "The live world's address starts with https:// (the address tailscale funnel printed).");
    const s = await settingsOf(d, g.who.tenantId);
    s.worldUrl = base ?? undefined;
    await updateSettings(d, g.who.tenantId, () => ({ worldUrl: s.worldUrl }));
    return back(req, base ? "Live world address saved: the Team page shows the world from it." : "Live world address cleared: the Team page shows no world.");
  }
  if (action === "samples") {
    // sample sites: auto-approve a draft whose copy passes the checks, and the places the team works
    // from (never on a page). The owner's; the places are shown to nobody else.
    const g = await guard("settings.rates");
    if ("res" in g) return g.res;
    const s = await settingsOf(d, g.who.tenantId);
    s.samplesAutoPublish = form.get("samples_auto_publish") === "on";
    const places = String(form.get("own_places") ?? "").split(/[\n,]+/).map((p) => p.replace(/\s+/g, " ").trim().slice(0, 60)).filter((p) => p.length >= 3);
    s.ownPlaces = [...new Set(places)].slice(0, 50);
    await updateSettings(d, g.who.tenantId, () => ({ samplesAutoPublish: s.samplesAutoPublish, ownPlaces: s.ownPlaces }));
    return back(req, `Sample settings saved: ${s.samplesAutoPublish ? "a draft that passes the checks is approved at once" : "a person approves each draft"}; ${s.ownPlaces.length} place${s.ownPlaces.length === 1 ? "" : "s"} never named.`);
  }
  if (action === "rates") {
    const g = await guard("settings.rates");
    if ("res" in g) return g.res;
    const s = await settingsOf(d, g.who.tenantId);
    const dec = (v: FormDataEntryValue | null) => {
      const t = String(v ?? "").trim();
      const n = Number(t);
      return t && Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : undefined;
    };
    s.rates = { hourly: dec(form.get("hourly")), outcomeBonus: dec(form.get("outcomeBonus")), currency: String(form.get("currency") ?? "USD").trim().toUpperCase().slice(0, 3) || "USD" };
    await updateSettings(d, g.who.tenantId, () => ({ rates: s.rates }));
    return back(req, "Default rates saved: new members start on them, and anyone without a rate of their own uses them. Approved statements stay as they were.");
  }
  if (action === "points") {
    const g = await guard("settings.rates");
    if ("res" in g) return g.res;
    const s = await settingsOf(d, g.who.tenantId);
    s.points = { sent: num(form.get("sent")), replies: num(form.get("replies")), meetings: num(form.get("meetings")), clients: num(form.get("clients")) };
    await updateSettings(d, g.who.tenantId, () => ({ points: s.points }));
    return back(req, "Leaderboard points saved. The board uses them from now, for the whole week and month.");
  }
  if (action === "addProject") {
    const g = await guard("projects.manage");
    if ("res" in g) return g.res;
    const r = await addProject(d, g.who.tenantId, String(form.get("name") ?? ""), String(form.get("client") ?? ""));
    return back(req, r.ok ? `Project "${r.project.name}" added. People can clock in to it now.` : r.error);
  }
  if (action === "projectActive") {
    const g = await guard("projects.manage");
    if ("res" in g) return g.res;
    const on = String(form.get("active")) === "1";
    await setProjectActive(d, g.who.tenantId, String(form.get("projectId") ?? ""), on);
    return back(req, on ? "Project restored to the picker." : "Project archived: it is out of the picker; its hours stay on the timesheets.");
  }
  if (action === "editProject") {
    // The projects panel's one form: name and update cadence together; only what changed is written.
    const g = await guard("projects.manage");
    if ("res" in g) return g.res;
    const id = String(form.get("projectId") ?? "");
    const p = (await projectsOf(d, g.who.tenantId)).find((x) => x.id === id);
    if (!p) return back(req, "That project is gone.");
    const name = String(form.get("name") ?? "").trim();
    if (name && name !== p.name) {
      const r = await renameProject(d, g.who.tenantId, id, name);
      if (!r.ok) return back(req, r.error);
    }
    const v = String(form.get("cadence") ?? "default");
    const minutes = v === "default" ? null : Number(v);
    if (minutes !== null && !CADENCES.some((c) => c.minutes === minutes)) return back(req, "Pick one of the update cadences.");
    const own = entryAt(p.cadenceHistory, new Date());
    if ((own?.minutes ?? null) !== minutes) await setProjectCadence(d, g.who.tenantId, id, minutes);
    return back(req, `${name || p.name}: saved.`);
  }
  if (action === "projectCadence") {
    const g = await guard("projects.manage");
    if ("res" in g) return g.res;
    const v = String(form.get("cadence") ?? "");
    const minutes = v === "default" ? null : Number(v);
    if (minutes !== null && !CADENCES.some((c) => c.minutes === minutes)) return back(req, "Pick one of the update cadences.");
    await setProjectCadence(d, g.who.tenantId, String(form.get("projectId") ?? ""), minutes);
    return back(req, "Update cadence saved. It applies from the next update window; the one under way keeps its length.");
  }
  if (action === "updates") {
    const g = await guard("projects.manage");
    if ("res" in g) return g.res;
    const s = await settingsOf(d, g.who.tenantId);
    const u = s.updates ?? {};
    const cadence = Number(form.get("cadence"));
    const rounding = Number(form.get("rounding"));
    const weekStartDay = Number(form.get("weekStartDay"));
    if (!CADENCES.some((c) => c.minutes === cadence) || !(ROUNDINGS as readonly number[]).includes(rounding) || !(weekStartDay >= 0 && weekStartDay <= 6)) return back(req, "Pick from the lists.");
    const current = cadenceFor(null, s)(new Date());
    s.updates = {
      ...u,
      defaultHistory: current === cadence ? u.defaultHistory : withChange(u.defaultHistory, cadence),
      rounding: rounding as 0 | 5 | 15,
      weekStartDay,
      idle: "off",
    };
    await updateSettings(d, g.who.tenantId, () => ({ updates: s.updates }));
    return back(req, "Time & updates saved. A new default cadence applies from each person's next update window.");
  }
  if (action === "renameProject") {
    const g = await guard("projects.manage");
    if ("res" in g) return g.res;
    const r = await renameProject(d, g.who.tenantId, String(form.get("projectId") ?? ""), String(form.get("name") ?? ""));
    return back(req, r.ok ? "Project renamed." : r.error);
  }
  if (action === "mergeProject") {
    const g = await guard("projects.manage");
    if ("res" in g) return g.res;
    const into = String(form.get("into") ?? "");
    const r = await mergeProjects(d, g.who.tenantId, String(form.get("projectId") ?? ""), into === "general" ? null : into);
    return back(req, r.ok ? "Projects merged: the hours moved over and the duplicate is gone." : r.error);
  }
  if (action === "name") {
    // a person's name: an owner or manager names anyone in the company; anyone names themselves
    const g = await guard("clock.own");
    if ("res" in g) return g.res;
    const userId = String(form.get("userId") ?? "");
    const name = String(form.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (userId !== g.who.userId && !can(g.who.role, "users.add")) return back(req, "Only an owner or manager can name someone else.");
    if (!name || /@/.test(name)) return back(req, "Write a name, not an email address.");
    const [target] = await d.select({ id: users.id }).from(users).where(and(eq(users.tenantId, g.who.tenantId), eq(users.id, userId)));
    if (!target) return back(req, "No such person.");
    await d.update(users).set({ name }).where(and(eq(users.tenantId, g.who.tenantId), eq(users.id, userId)));
    return back(req, `Name saved: ${name}. It shows on packs, Sent by, statements and This week from now on.`);
  }
  if (action === "role") {
    const g = await guard("users.manage");
    if ("res" in g) return g.res;
    const [target] = await d.select().from(users).where(and(eq(users.tenantId, g.who.tenantId), eq(users.id, String(form.get("userId") ?? ""))));
    const to = String(form.get("role") ?? "") as Role;
    if (!target || !["manager", "member"].includes(to) || !canSetRole({ id: g.who.userId, role: g.who.role }, target, to)) return back(req, "That role change is not allowed.");
    await d.update(users).set({ role: to }).where(and(eq(users.tenantId, g.who.tenantId), eq(users.id, target.id)));
    return back(req, "Role changed.");
  }
  if (action === "memberRate") {
    const g = await guard("rates.members");
    if ("res" in g) return g.res;
    const [target] = await d.select().from(users).where(and(eq(users.tenantId, g.who.tenantId), eq(users.id, String(form.get("userId") ?? ""))));
    if (!target || !canSetRate({ id: g.who.userId, role: g.who.role }, target)) return back(req, "You cannot set that person's rate.");
    const from = String(form.get("effectiveFrom") ?? "").trim() || dayOf(new Date());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(new Date(`${from}T00:00:00`).getTime())) return back(req, "The start date must be a date (YYYY-MM-DD).");
    const hourly = money(form.get("hourly"));
    const outcomeBonus = money(form.get("outcomeBonus"));
    if (hourly === undefined && outcomeBonus === undefined) return back(req, "Give an hourly rate, an outcome bonus or both.");
    const currency = String(form.get("currency") ?? "USD").trim().toUpperCase().slice(0, 3) || "USD";
    await setRate(d, g.who.tenantId, target.id, from, { hourly, outcomeBonus, currency }, g.who.userId);
    return back(req, `${displayName(target.name, target.email)}: new rate from ${from}. Hours from that day on use it; approved statements stay as they were.`);
  }
  if (action === "person") {
    // One Save for a person: their name, role and rate in one form, each written only when it changed and only
    // under its own rule -- anyone names themselves and an owner or manager names anyone; roles by users.manage; a rate by
    // rates.members for one the actor may set, never under an approved statement.
    const g = await guard("clock.own");
    if ("res" in g) return g.res;
    const [target] = await d.select().from(users).where(and(eq(users.tenantId, g.who.tenantId), eq(users.id, String(form.get("userId") ?? ""))));
    if (!target) return back(req, "No such person.");
    const label = displayName(target.name, target.email);
    const done: string[] = [];
    const name = String(form.get("name") ?? "").replace(/\s+/g, " ").trim().slice(0, 80);
    if (form.has("name") && name !== (target.name ?? "")) {
      if (target.id !== g.who.userId && !can(g.who.role, "users.add")) return back(req, "Only an owner or manager can name someone else.");
      if (!name || /@/.test(name)) return back(req, "Write a name, not an email address.");
      await d.update(users).set({ name }).where(and(eq(users.tenantId, g.who.tenantId), eq(users.id, target.id)));
      done.push(`name saved as ${name}`);
    }
    const to = String(form.get("role") ?? "") as Role;
    if (form.has("role") && to && to !== target.role) {
      if (!can(g.who.role, "users.manage") || !["manager", "member"].includes(to) || !canSetRole({ id: g.who.userId, role: g.who.role }, target, to)) return back(req, "That role change is not allowed.");
      await d.update(users).set({ role: to }).where(and(eq(users.tenantId, g.who.tenantId), eq(users.id, target.id)));
      done.push(`role now ${to}`);
    }
    if (form.get("offBoardTouched") === "1") {
      // the owner alone keeps a person off the team's board; an owner account is always off it
      const want = form.get("offBoard") === "1";
      const s = await settingsOf(d, g.who.tenantId);
      const was = Array.isArray(s.offTeamBoard) && s.offTeamBoard.includes(target.id);
      if (want !== was) {
        if (g.who.role !== "owner" || target.role === "owner") return back(req, "Only the owner keeps someone off the team board.");
        await updateSettings(d, g.who.tenantId, (now) => ({ offTeamBoard: withOffBoard(now.offTeamBoard, target.id, want) }));
        done.push(want ? "off the team board" : "back on the team board");
      }
    }
    if (form.get("rateTouched") === "1") {
      if (!can(g.who.role, "rates.members") || !canSetRate({ id: g.who.userId, role: g.who.role }, target)) return back(req, "You cannot set that person's rate.");
      const from = String(form.get("effectiveFrom") ?? "").trim() || dayOf(new Date());
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || Number.isNaN(new Date(`${from}T00:00:00`).getTime())) return back(req, "The start date must be a date (YYYY-MM-DD).");
      const history = await rateHistory(d, g.who.tenantId, target.id);
      const weeks = (await approvedWeeks(d, g.who.tenantId)).get(target.id) ?? [];
      const cur = rateOn(history, (await settingsOf(d, g.who.tenantId)).rates ?? {}, dayOf(new Date()));
      const write = rateToWrite(cur, { touched: true, hourly: money(form.get("hourly")), outcomeBonus: money(form.get("outcomeBonus")), currency: String(form.get("currency") ?? ""), from });
      if (write) {
        const lastApproved = weeks.length ? addDays([...weeks].sort().at(-1)!, 6) : "";
        if (rateLocks(history, weeks).has(from) || (lastApproved && from <= lastApproved)) return back(req, `${label}: a rate can't start on or before ${lastApproved}; approved weeks keep the rate they were paid at.`);
        await setRate(d, g.who.tenantId, target.id, from, { hourly: write.hourly, outcomeBonus: write.outcomeBonus, currency: write.currency }, g.who.userId);
        done.push(`new rate from ${from}`);
      }
    }
    return back(req, done.length ? `${label}: ${done.join(", ")}.` : `${label}: nothing changed.`);
  }
  if (action === "removeRate") {
    // a rate set by mistake: removed only when no approved statement lies under it
    const g = await guard("rates.members");
    if ("res" in g) return g.res;
    const [target] = await d.select().from(users).where(and(eq(users.tenantId, g.who.tenantId), eq(users.id, String(form.get("userId") ?? ""))));
    if (!target || !canSetRate({ id: g.who.userId, role: g.who.role }, target)) return back(req, "You cannot change that person's rate.");
    const from = String(form.get("effectiveFrom") ?? "");
    const history = await rateHistory(d, g.who.tenantId, target.id);
    if (!history.some((r) => r.effectiveFrom === from)) return back(req, "No such rate.");
    if (rateLocks(history, (await approvedWeeks(d, g.who.tenantId)).get(target.id) ?? []).has(from)) return back(req, "That rate is under an approved week: it stays as it was paid.");
    await removeRate(d, g.who.tenantId, target.id, from);
    return back(req, `${displayName(target.name, target.email)}: the rate from ${from} is removed.`);
  }
  return back(req, "Unknown action.");
}
