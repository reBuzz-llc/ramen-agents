// Server-side only: whole episodes from a bot's database, as structured data and as text to copy.
//
// The activity feed only holds the latest log lines, which often start mid-episode; the database has every
// episode with its question, each action (the model's thought, the verdict, the result), the notes saved and
// the summary written at the end. Read with macOS's own sqlite3 in read-only mode, so this app never
// writes a bot's database and needs no native Node module.
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import type { BotProfile } from "./bot";
import { readConfig } from "./bots";

const run = promisify(execFile);
const SQLITE = "/usr/bin/sqlite3";

export async function dbPath(bot: BotProfile): Promise<string> {
  const cfg = await readConfig(bot.configPath);
  const rel = cfg.get("paths.db");
  return path.resolve(path.dirname(bot.configPath), typeof rel === "string" && rel ? rel : "workspace/explorer.sqlite3");
}

export type Row = Record<string, string | number | null>;

export async function query(db: string, sql: string): Promise<Row[]> {
  // -readonly plus a read-only URI: the bot writes this file (WAL), this app never does.
  const { stdout } = await run(SQLITE, ["-readonly", "-json", "-cmd", ".timeout 3000", `file:${db}?mode=ro`, sql], {
    timeout: 8000,
    maxBuffer: 32 * 1024 * 1024,
  });
  return stdout.trim() ? (JSON.parse(stdout) as Row[]) : [];
}
