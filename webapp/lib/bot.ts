// Shapes returned by the Python data server (`bot dashboard`, src/explorer/dashboard.py).

export type Heartbeat = {
  id: number;
  ts: string;
  cycle: number;
  status: string; // starting | running | quiet | paused | exiting
  current_url: string | null;
  current_question: string | null;
  last_action: string | null;
  last_progress_at: string | null;
  model_failures: number;
  next_planned: string | null;
  pid: number | null;
};

export type BotState = {
  agent: { name: string; mode: string; model: string; browser?: string };
  running: boolean;
  pid: number | null;
  flags: string[];
  heartbeat: Heartbeat | null;
  heartbeat_age: number | null;
  stale: boolean;
  counts: {
    notes: number;
    open_questions: number;
    answered_questions: number;
    interests: number;
    visits: number;
    episodes: number;
    actions: number;
  };
  episode: { id: number; actions: number; question_id: number | null } | null;
  budget: number;
  pages_last_hour: number;
  pages_per_hour: number;
  screenshot_at: string | null;
  now: string;
};

// Log lines are flat JSON; every extra field arrives as a string.
export type BotEvent = {
  ts: string;
  level: string;
  msg: string;
  kind?: string;
  [field: string]: string | undefined;
};

// One bot folder under ~/bots, as the web app sees it.
export type BotProfile = {
  slug: string;
  name: string;
  bio: string;
  port: number;
  configPath: string;
  /** ceoA for an agent (its own model-driven loop), valB for a bot (a timer job): lib/handle.ts. */
  handle: string;
};

// A profile plus a live status summary, for the switcher.
// A pause or slow-down The CEO put on this bot (workspace/HOLD, engine hold.py; owner, 2026-10-07). Ends by itself.
export type BotHold = { by: string; mode: "pause" | "slow"; until: string; why: string };

export type BotSummary = BotProfile & {
  hold?: BotHold | null;
  online: boolean;
  running: boolean;
  status: string | null;
  flags: string[];
  stale: boolean;
  heartbeatAge: number | null;
};
