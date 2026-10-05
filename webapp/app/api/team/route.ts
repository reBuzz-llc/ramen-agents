import type { NextRequest } from "next/server";
import { findBot } from "@/lib/bots";
import { sameOrigin } from "@/lib/same-origin";
import { notionEnabled, notionUsers, readTeam, teamFile, writeTeam } from "@/lib/team";

const NO_STORE = { "cache-control": "no-store" };

async function scope(slug: string | null) {
  const bot = slug ? await findBot(slug) : null;
  if (slug && !bot) return { error: Response.json({ error: "not found" }, { status: 404 }) };
  return { bot: bot ?? undefined, enabled: bot ? await notionEnabled(bot) : true, file: await teamFile(bot ?? undefined) };
}

// The team and the Notion workspace's people: GET ?bot=slug[&refresh=1]
export async function GET(req: NextRequest) {
  const s = await scope(req.nextUrl.searchParams.get("bot"));
  if (s.error) return s.error;
  const [team, notion] = await Promise.all([readTeam(s.file), s.enabled ? notionUsers(req.nextUrl.searchParams.get("refresh") === "1") : Promise.resolve({ users: [], error: null })]);
  return Response.json({ enabled: s.enabled, file: s.file, team, users: notion.users, notionError: notion.error }, { headers: NO_STORE });
}

// Save the team: PUT {bot, members}. Only people the workspace lists (or already saved) are kept.
export async function PUT(req: Request) {
  if (!(await sameOrigin(req))) return Response.json({ error: "forbidden" }, { status: 403 });
  let body: { bot?: unknown; members?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "expected JSON" }, { status: 400 });
  }
  const s = await scope(typeof body.bot === "string" ? body.bot : null);
  if (s.error) return s.error;
  if (!Array.isArray(body.members)) return Response.json({ error: "members must be a list" }, { status: 400 });
  const notion = await notionUsers();
  try {
    const team = await writeTeam(s.file, body.members, new Map(notion.users.map((u) => [u.id, u])));
    return Response.json({ team, notionError: notion.error }, { headers: NO_STORE });
  } catch (err) {
    return Response.json({ error: `could not save the team: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
  }
}
