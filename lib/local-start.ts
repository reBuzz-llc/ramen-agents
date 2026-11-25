// The start check for sign-in off, run once by instrumentation.ts on the Node.js runtime before the server answers
// anything (lib/local-mode.ts): with sign-in on it does nothing; with sign-in off a server not told to listen on this
// computer only stops with the reason, else the local owner is made or found, so the scripts that run while Peek is
// stopped (api-key.mjs, rebuild-load.mjs) find the company.
import { bindOk, ensureLocalOwner, signInMode } from "./local-mode";

export async function localStart(argv: string[] = process.argv, exit: (code: number) => void = (c) => process.exit(c), env: Record<string, string | undefined> = process.env): Promise<"on" | "stopped" | "local"> {
  if (signInMode(env) !== "off") return "on";
  if (!bindOk(argv)) {
    console.error("peek: sign-in is off (PEEK_SIGNIN=off), so Peek listens on this computer only: start it with -H 127.0.0.1");
    exit(1);
    return "stopped";
  }
  const { db } = await import("./db");
  await ensureLocalOwner(await db(), env);
  return "local";
}
