// Server-side only: the whole fleet over a period, for the Summary tab's "All bots" view. Each bot's own
// database (read-only, as lib/summary.ts), its live state from its data server, and the relation map:
// which bot hands work to which (config [handoff] and [[messaging.peers]]) and how much actually moved
// through those channels in the period (the sender's `package` and `message` actions), plus the owner's
// chat, tasks sent to Notion and AI providers recorded by the Scout.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { BotProfile } from "./bot";
import { fetchState, listBots, readConfig, readHold } from "./bots";
import { agentPids, flags } from "./control";
import { readRoom } from "./chatroom";
import { readDigest } from "./digest";
import { dbPath, query, type Row } from "./episodes";
import { bucketLabel, bucketStarts, localIso, RANGES, sq, totals, type RangeKey, type Totals } from "./summary";

export type FleetBot = {
  slug: string;
  name: string;
  handle: string;
  online: boolean; // its data server answers -- true for a stopped bot too (com.ramen-agents.data.<slug> keeps running)
  running: boolean; // its loop is alive and no STOP or PAUSE file is set: what "online" on the map means to the owner
  stopped: boolean; // a STOP file is set (the owner's stop)
  hold: import("./bot").BotHold | null; // a pause or slow-down The CEO set (workspace/HOLD), until it ends
  status: string | null;
  lastActive: string | null;
  totals: Totals;
  previous: Totals;
  /** Allowed actions per bucket (same buckets as the per-bot chart). */
  spark: number[];
  outputs: { packages: number; messages: number; providers: number; says: number };
  /** The saved AI recap for this range, if one has been written. */
  recap: { text: string; generatedAt: string; goals: { goal: string; verdict: string }[] } | null;
  error: string | null;
};

export type MapNode = { id: string; kind: "owner" | "bot" | "room" | "notion" | "providers"; label: string; slug?: string; online?: boolean; running?: boolean; held?: boolean; handle?: string };
export type MapEdge = {
  id: string;
  from: string;
  to: string;
  kind: "handoff" | "message" | "room" | "chat" | "say" | "task" | "provider";
  label: string;
  /** Configured channel (bot to bot) even when nothing moved in the period. */
  configured: boolean;
  count: number;
  refused: number;
};
export type Exchange = { at: string; edge: string; from: string; to: string; kind: MapEdge["kind"]; title: string; text: string; href: string | null; refused: string | null };

export type FleetData = {
  range: RangeKey;
  since: string;
  labels: string[];
  bots: FleetBot[];
  totals: Totals;
  previous: Totals;
  map: { nodes: MapNode[]; edges: MapEdge[] };
  exchanges: Exchange[];
};

const str = (v: unknown) => (v === null || v === undefined ? "" : String(v));
const ZERO: Totals = { episodes: 0, notes: 0, answered: 0, asked: 0, tasks: 0, pages: 0, actions: 0, refused: 0 };
const add = (a: Totals, b: Totals): Totals => Object.fromEntries(Object.keys(a).map((k) => [k, a[k as keyof Totals] + b[k as keyof Totals]])) as Totals;

function parse(payload: unknown): Record<string, unknown> {
  try {
    const v = JSON.parse(str(payload));
    return v && typeof v === "object" ? v : {};
  } catch {
    return {};
  }
}

/** [[messaging.peers]] tables (name + folder). readToml keeps only plain [sections], so these are read here. */
function peersOf(text: string): { name: string; folder: string }[] {
  const out: { name: string; folder: string }[] = [];
  const blocks = text.split(/^\s*\[\[messaging\.peers\]\]\s*$/m).slice(1);
  for (const block of blocks) {
    const body = block.split(/^\s*\[/m)[0];
    const name = body.match(/^\s*name\s*=\s*"([^"]*)"/m)?.[1];
    const folder = body.match(/^\s*folder\s*=\s*"([^"]*)"/m)?.[1];
    if (name && folder) out.push({ name, folder });
  }
  return out;
}

type Channels = { handoff: { toName: string; toFolder: string } | null; messaging: { name: string; folder: string }[] };

export async function channels(bot: BotProfile): Promise<Channels> {
  const cfg = await readConfig(bot.configPath);
  const own = await readFile(/*turbopackIgnore: true*/ bot.configPath, "utf8");
  const handoff =
    cfg.get("handoff.enabled") === true && typeof cfg.get("handoff.to_folder") === "string"
      ? { toName: str(cfg.get("handoff.to_name")), toFolder: str(cfg.get("handoff.to_folder")) }
      : null;
  return { handoff, messaging: cfg.get("messaging.enabled") === true ? peersOf(own) : [] };
}

function botForFolder(bots: BotProfile[], folder: string): BotProfile | undefined {
  const want = path.resolve(folder.replace(/^~(?=\/)/, process.env.HOME ?? "~"));
  return bots.find((b) => path.dirname(b.configPath) === want);
}

export async function fleetSummary(range: RangeKey): Promise<FleetData> {
  const bots = await listBots();
  const now = Date.now();
  const starts = bucketStarts(range, now);
  const since = localIso(starts[0]);
  const until = localIso(now + 60e3);
  const prevFrom = localIso(starts[0] - (now - starts[0]));
  const bucketIso = starts.map(localIso);

  const nodes: MapNode[] = [{ id: "owner", kind: "owner", label: "You" }];
  const edges = new Map<string, MapEdge>();
  const exchanges: Exchange[] = [];
  const edge = (from: string, to: string, kind: MapEdge["kind"], label: string, configured = false): MapEdge => {
    const id = `${from}>${to}:${kind === "handoff" || kind === "message" || kind === "room" ? "work" : kind}`;
    let e = edges.get(id);
    if (!e) edges.set(id, (e = { id, from, to, kind, label, configured, count: 0, refused: 0 }));
    e.configured ||= configured;
    return e;
  };

  const perBot = await Promise.all(
    bots.map(async (bot): Promise<{ bot: BotProfile; row: FleetBot; ch: Channels; acts: Row[]; chats: Row[]; counts: Row[]; chatCount: number }> => {
      const [state, ch, digest, flagList, pids, hold] = await Promise.all([
        fetchState(bot),
        channels(bot).catch(() => ({ handoff: null, messaging: [] }) as Channels),
        readDigest(bot, range),
        flags(bot).catch(() => [] as string[]),
        agentPids(bot.configPath, path.join(path.dirname(bot.configPath), "workspace", "explorer.pid")).catch(() => [] as number[]),
        readHold(bot),
      ]);
      const stopped = flagList.includes("STOP");
      const running = pids.length > 0 && !stopped && !flagList.includes("PAUSE");
      const base: FleetBot = {
        slug: bot.slug, name: bot.name, handle: bot.handle, online: state !== null, running, stopped, hold, status: state?.heartbeat?.status ?? null, lastActive: null,
        totals: ZERO, previous: ZERO, spark: starts.map(() => 0), outputs: { packages: 0, messages: 0, providers: 0, says: 0 },
        recap: digest ? { text: digest.recap, generatedAt: digest.generatedAt, goals: digest.goals.map((g) => ({ goal: g.goal, verdict: g.verdict })) } : null,
        error: null,
      };
      try {
        const db = await dbPath(bot);
        const [cur, prev, sparkRows, last, acts, chats, counts, chatTotal] = await Promise.all([
          totals(db, since, until),
          totals(db, prevFrom, since),
          query(db, `SELECT ts FROM actions WHERE ts >= ${sq(since)} AND verdict = 'allowed'`),
          query(db, `SELECT max(ts) AS ts FROM actions`),
          query(db, `SELECT ts, action_type, verdict, payload FROM actions WHERE ts >= ${sq(since)} AND action_type IN ('package','message','provider','say','task') ORDER BY id DESC LIMIT 400`),
          query(db, `SELECT ts, text FROM chat WHERE role = 'owner' AND ts >= ${sq(since)} ORDER BY id DESC LIMIT 100`).catch(() => [] as Row[]),
          // The counts come from here, not from the 400 rows above: a bot with thousands of refused tasks filled that
          // window and its messages were undercounted by a quarter on the 30-day view (review, 2026-09-25).
          query(
            db,
            `SELECT action_type AS t, verdict = 'allowed' AS ok, ` +
              `lower(trim(CASE WHEN json_valid(payload) THEN coalesce(json_extract(payload, '$.to'), '') ELSE '' END)) AS dest, COUNT(*) AS n ` +
              `FROM actions WHERE ts >= ${sq(since)} AND action_type IN ('package','message','provider','say','task') GROUP BY 1, 2, 3`,
          ),
          query(db, `SELECT COUNT(*) AS n FROM chat WHERE role = 'owner' AND ts >= ${sq(since)}`).catch(() => [{ n: 0 }] as Row[]),
        ]);
        for (const r of sparkRows) {
          const t = localIso(new Date(str(r.ts)).getTime());
          if (t < bucketIso[0]) continue;
          let i = bucketIso.length - 1;
          while (i > 0 && t < bucketIso[i]) i--;
          base.spark[i]++;
        }
        const allowed = (type: string) => counts.filter((c) => str(c.t) === type && Number(c.ok) === 1).reduce((n, c) => n + Number(c.n), 0);
        base.totals = cur;
        base.previous = prev;
        base.lastActive = last[0]?.ts ? str(last[0].ts) : null;
        base.outputs = { packages: allowed("package"), messages: allowed("message"), providers: allowed("provider"), says: allowed("say") };
        return { bot, row: base, ch, acts, chats, counts, chatCount: Number(chatTotal[0]?.n ?? 0) };
      } catch (err) {
        return { bot, row: { ...base, error: err instanceof Error ? err.message.split("\n")[0] : String(err) }, ch, acts: [], chats: [], counts: [], chatCount: 0 };
      }
    }),
  );

  for (const { bot, row } of perBot) nodes.push({ id: `bot:${bot.slug}`, kind: "bot", label: bot.name, slug: bot.slug, online: row.online, running: row.running, held: row.hold !== null, handle: bot.handle });
  let notion = false;
  let providers = false;

  for (const { bot, ch, acts, chats, counts, chatCount } of perBot) {
    const me = `bot:${bot.slug}`;
    const summaryHref = (slug: string) => `/bots/${slug}/summary?scope=bot`; // scope=bot: the fleet scope is remembered in a cookie
    // Configured channels first, so a quiet channel still shows as a dashed line.
    const handoffTo = ch.handoff ? botForFolder(bots, ch.handoff.toFolder) : undefined;
    if (handoffTo) edge(me, `bot:${handoffTo.slug}`, "handoff", "packages", true);
    const peers = ch.messaging.map((p) => ({ ...p, bot: botForFolder(bots, p.folder) })).filter((p) => p.bot);
    for (const p of peers) edge(me, `bot:${p.bot!.slug}`, "message", "messages", true);
    if (chatCount) {
      const e = edge("owner", me, "chat", "chat");
      e.count += chatCount;
      for (const c of chats.slice(0, 12)) exchanges.push({ at: str(c.ts), edge: e.id, from: "You", to: bot.name, kind: "chat", title: "Chat message", text: str(c.text).slice(0, 400), href: `/bots/${bot.slug}/chat`, refused: null });
    }

    const isRoom = (to: string) => /^(everyone|all|room|the room|chatroom|the chatroom)$/i.test(to.trim());
    for (const c of counts) {
      const type = str(c.t);
      const dest = str(c.dest);
      let e: MapEdge | null = null;
      if (type === "package" && handoffTo) e = edge(me, `bot:${handoffTo.slug}`, "handoff", "packages");
      else if (type === "message" && !isRoom(dest)) {
        const peer = peers.find((x) => x.name.toLowerCase() === dest);
        if (peer) e = edge(me, `bot:${peer.bot!.slug}`, "message", "messages");
      } else if (type === "say") e = edge(me, "owner", "say", "said");
      else if (type === "task") {
        notion = true;
        e = edge(me, "notion", "task", "tasks");
      } else if (type === "provider") {
        providers = true;
        e = edge(me, "providers", "provider", "providers");
      }
      if (!e) continue;
      if (Number(c.ok) === 1) e.count += Number(c.n);
      else e.refused += Number(c.n);
    }

    // The newest rows, for the exchanges list only (the counts above are complete).
    for (const a of acts) {
      const type = str(a.action_type);
      const p = parse(a.payload);
      const ok = str(a.verdict) === "allowed";
      const refusedWhy = ok ? null : str(a.verdict).replace(/^rejected:\s*/, "").slice(0, 200);
      let e: MapEdge | null = null;
      let title = "";
      let text = "";
      let to = "";
      let href: string | null = summaryHref(bot.slug);
      if (type === "package" && handoffTo) {
        e = edge(me, `bot:${handoffTo.slug}`, "handoff", "packages");
        to = handoffTo.name;
        title = `Package: ${str(p.name) || "untitled"}${p.price ? ` (${str(p.price)})` : ""}`;
        text = [str(p.audience) && `For ${str(p.audience)}.`, str(p.rationale)].filter(Boolean).join(" ");
      } else if (type === "message" && isRoom(str(p.to))) {
        continue; // a post to the shared chatroom: counted from the room file below, where it actually landed
      } else if (type === "message") {
        const peer = peers.find((x) => x.name.toLowerCase() === str(p.to).trim().toLowerCase());
        if (!peer) continue;
        e = edge(me, `bot:${peer.bot!.slug}`, "message", "messages");
        to = peer.bot!.name;
        title = `Message to ${to}`;
        text = str(p.text);
      } else if (type === "say") {
        e = edge(me, "owner", "say", "said");
        to = "You";
        title = "Said to you";
        text = str(p.text);
        href = `/bots/${bot.slug}/chat`;
      } else if (type === "task") {
        notion = true;
        e = edge(me, "notion", "task", "tasks");
        to = "Notion";
        title = `Task: ${str(p.title) || "untitled"}`;
        text = str(p.body ?? p.description ?? "");
      } else if (type === "provider") {
        providers = true;
        e = edge(me, "providers", "provider", "providers");
        to = "Provider finds";
        title = `Provider: ${str(p.name) || "unnamed"}`;
        text = [str(p.base_url), str(p.free_terms)].filter(Boolean).join(" · ");
      }
      if (!e) continue;
      exchanges.push({ at: str(a.ts), edge: e.id, from: bot.name, to, kind: e.kind, title, text: text.slice(0, 600), href, refused: refusedWhy });
    }
  }
  // The shared chatroom (common-data/chatroom.jsonl): every post in the period, by sender.
  // Posts only: read receipts and handoff reports are the controller's bookkeeping, not a bot talking.
  const posts = (await readRoom(100000)).filter((r) => r.kind === "post" && r.ts && localIso(new Date(r.ts).getTime()) >= since);
  if (posts.length || perBot.some((p) => p.ch.messaging.length)) {
    nodes.push({ id: "room", kind: "room", label: "Chatroom" });
    for (const post of posts) {
      const bot = bots.find((b) => b.name.toLowerCase() === post.sender.trim().toLowerCase());
      if (!bot) continue;
      const e = edge(`bot:${bot.slug}`, "room", "room", "posts");
      e.count++;
      exchanges.push({ at: localIso(new Date(post.ts).getTime()), edge: e.id, from: bot.name, to: "Chatroom", kind: "room", title: "Chatroom post", text: post.text.slice(0, 600), href: "/chatroom", refused: null });
    }
  }
  if (notion) nodes.push({ id: "notion", kind: "notion", label: "Notion" });
  if (providers) nodes.push({ id: "providers", kind: "providers", label: "Provider finds" });

  exchanges.sort((a, b) => (a.at < b.at ? 1 : -1));
  const rows = perBot.map((p) => p.row);
  return {
    range,
    since,
    labels: starts.map((s) => bucketLabel(range, s)),
    bots: rows,
    totals: rows.reduce((t, b) => add(t, b.totals), ZERO),
    previous: rows.reduce((t, b) => add(t, b.previous), ZERO),
    map: { nodes, edges: [...edges.values()] },
    exchanges: exchanges.slice(0, 150),
  };
}

export { RANGES };
