// The browser-safe half of lib/agent-presence.ts: whether an agent is missing, and the one line a page shows for it.
import { agentName } from "./agent-names";

/** The agent's name when the team is known not to run it; "" when it does, or when Peek cannot tell. */
export const missingAgent = (agents: Set<string> | null, name: string) => (agents && !agents.has(name.toLowerCase()) ? name : "");

/** The one line a page shows for a missing agent: what the page holds, and which agent brings it. */
export const missingLine = (what: string, name: string) => `${what} come from the ${agentName(name)}, which is not on your team yet.`;
