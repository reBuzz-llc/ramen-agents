import { NextResponse } from "next/server";
import { publicReason } from "@/lib/errors";
import { cadenceFor, CADENCES, entryAt, ROUNDINGS, withChange } from "@/lib/cadence";
import { addProject, mergeProjects, projectsOf, renameProject, setProjectActive, setProjectCadence } from "@/lib/projects";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tenants, users } from "@/lib/db/schema";
import { guard } from "@/lib/guard";
import { canSetRole, type Role } from "@/lib/roles";
import { sameOrigin } from "@/lib/same-origin";
import { boardById, forgetBoard, forgetTasks, NotionError, whoAmI } from "@/lib/notion";
import { idFromInput, missingLeadsColumns, NONE_SHARED, NOT_ACCEPTED } from "@/lib/notion-pick";
import { connectNotion, disconnectNotion, notionOf, settingsOf } from "@/lib/tenants";
import { setRate } from "@/lib/member-rates";
import { sectionOf } from "@/lib/settings-nav";
import { canSetRate, dayOf, money } from "@/lib/rates";

// Back to the page the form was on: its Settings page (lib/settings-nav.ts sectionOf), or the Clock page's "Manage
// projects" (a form there sends return=/). Kept per request, never in a module variable shared by requests running at once.
const returns = new WeakMap<Request, string>();
const back = (req: Request, msg: string) => NextResponse.redirect(new URL(`${returns.get(req) ?? "/settings"}?msg=${encodeURIComponent(msg)}`, req.url), 303);
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

  if (action === "notion") {
    const g = await guard("settings.notion");
    if ("res" in g) return g.res;
    // The token pasted now, else the one already stored (changing boards without pasting it again).
    const token = String(form.get("token") ?? "").replace(/\s+/g, "") || (await notionOf(d, g.who.tenantId).catch(() => null))?.token;
    if (!token) return back(req, "Paste your Notion token first. How to get one: /help/connect-notion");
    // A board from the picker, or an id or Notion URL pasted under "advanced"; the pasted one wins.
    const pick = (name: string) => String(form.get(`${name}Raw`) ?? "").trim() || String(form.get(name) ?? "").trim();
    const leadsIn = pick("leads");
    const tasksIn = pick("tasks");
    if (!leadsIn) return back(req, "Choose the Leads board.");
    const leadsId = idFromInput(leadsIn);
    if (!leadsId) return back(req, "That Leads board id or link has no Notion id in it. Copy the board's link from Notion (··· → Copy link) and paste it whole.");
    const tasksId = tasksIn ? idFromInput(tasksIn) : null;
    if (tasksIn && !tasksId) return back(req, "That task board id or link has no Notion id in it. Leave it empty if you have no task board.");
    try {
      // The token first, so a bad paste is refused with Notion's own words before anything is stored.
      let integration: { name: string };
      try {
        integration = await whoAmI(token);
      } catch (err) {
        if (err instanceof NotionError && err.status === 401) return back(req, `Notion says: ${err.notionSays || "API token is invalid."} ${NOT_ACCEPTED}`);
        throw err;
      }
      const leads = await boardById(token, leadsId);
      if (!leads) return back(req, `ramen-agents cannot see that Leads board. ${NONE_SHARED}`);
      const tasks = tasksId ? await boardById(token, tasksId) : null;
      if (tasksId && !tasks) return back(req, "ramen-agents cannot see that task board. In Notion, open it, click ··· → Connections, and add your integration.");
      await connectNotion(d, g.who.tenantId, token, leads, tasks, integration.name);
      forgetTasks(g.who.tenantId);
      forgetBoard(g.who.tenantId);
      const missing = missingLeadsColumns(leads);
      return back(
        req,
        missing.length
          ? `Connected to "${leads.title}", but it has no ${missing.map((c) => `"${c}"`).join(" or ")} column, so Our queue will be empty until it does.`
          : `Connected as ${integration.name} to "${leads.title}"${tasks ? ` and "${tasks.title}"` : ""}. The token is stored encrypted.`,
      );
    } catch (err) {
      if (err instanceof NotionError && err.status === 401) return back(req, NOT_ACCEPTED);
      return back(req, `${publicReason(err, "settings.notion")} Nothing was changed.`);
    }
  }
  if (action === "notionDisconnect") {
    const g = await guard("settings.notion");
    if ("res" in g) return g.res;
    await disconnectNotion(d, g.who.tenantId);
    forgetTasks(g.who.tenantId);
    forgetBoard(g.who.tenantId);
    return back(req, "Notion disconnected. The stored token and the cached rows are deleted; your board in Notion is unchanged.");
  }
  if (action === "keyResults") {
    const g = await guard("settings.keyResults");
    if ("res" in g) return g.res;
    const s = await settingsOf(d, g.who.tenantId);
    s.keyResults = { sent: num(form.get("sent")), replies: num(form.get("replies")), meetings: num(form.get("meetings")), tasksDone: num(form.get("tasksDone")) };
    await d.update(tenants).set({ settings: s }).where(eq(tenants.id, g.who.tenantId));
    return back(req, "This week's key results saved.");
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
    await d.update(tenants).set({ settings: s }).where(eq(tenants.id, g.who.tenantId));
    return back(req, "Default rates saved: new members start on them, and anyone without a rate of their own uses them. Approved statements stay as they were.");
  }
  if (action === "points") {
    const g = await guard("settings.rates");
    if ("res" in g) return g.res;
    const s = await settingsOf(d, g.who.tenantId);
    s.points = { sent: num(form.get("sent")), replies: num(form.get("replies")), meetings: num(form.get("meetings")), clients: num(form.get("clients")), tasksDone: num(form.get("tasksDone")) };
    await d.update(tenants).set({ settings: s }).where(eq(tenants.id, g.who.tenantId));
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
    await d.update(tenants).set({ settings: s }).where(eq(tenants.id, g.who.tenantId));
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
    return back(req, `${target.name || target.email}: new rate from ${from}. Hours from that day on use it; approved statements stay as they were.`);
  }
  return back(req, "Unknown action.");
}
