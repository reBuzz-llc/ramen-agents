// A short handle for telling the fleet apart at a glance (owner, 2026-09-25): the first three letters of
// the distinctive name, then A for an agent or B for a bot --
//
//   agent  runs its own loop: it decides each step with a model and keeps a journal. The CEO is ceoA,
//          Package Designer pacA, Onion Reader oniA.
//   bot    runs on a timer or a trigger and follows fixed rules: it has no loop of its own. The Validator
//          is valB. Marked in its config with [agent] not_a_bot_run_agent = true.
//
// Display only: they keep their full names in their prompts, in their messages to each other and in
// Notion, because "You are The CEO" carries a role that "ceoA" does not and they address one another by
// exact name. Pure and dependency-free, so the server can stamp it on a profile and the browser can use it.

export type Kind = "agent" | "bot";

export function handleFor(name: string, kind: Kind = "agent"): string {
  const words = name
    .trim()
    .replace(/^the\s+/i, "")
    .split(/[\s\-_]+/)
    .filter(Boolean);
  const stem = (words[0] ?? "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 3);
  return stem ? `${stem}${kind === "bot" ? "B" : "A"}` : "?";
}
