// An agent's name on screen can carry its nickname (e.g. "Site Builder (abcA)"), so anyone can tell which one is meant.
// The nicknames are each team's own: NEXT_PUBLIC_PEEK_AGENT_NICKNAMES lists them as "Name=nick" pairs split by ";"
// ("Site Builder=abcA;Validator=valB"), set at build time so the browser side sees them too. Without it an agent shows by
// its plain name. Display only: what is stored, compared and sent to the agents stays the plain name.

/** "Name=nick;Name=nick" as a map from the lower-cased name to "Name (nick)". */
export function nicknames(raw: string | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of (raw ?? "").split(";")) {
    const [name, nick] = pair.split("=").map((s) => s?.trim() ?? "");
    if (name && nick) out.set(name.toLowerCase(), `${name} (${nick})`);
  }
  return out;
}

// read here, in so many words, so the build inlines it for the browser side
const BY_NAME = nicknames(process.env.NEXT_PUBLIC_PEEK_AGENT_NICKNAMES);

/** A stored name as shown: an agent's with its nickname when the team set one, anything else (a person, a job) as it is. */
export const agentName = (name: string) => BY_NAME.get(name.trim().toLowerCase()) ?? name;

/** The nickname alone ("" when the team set none), e.g. to recognise a name stored as the nickname. */
export const nicknameOf = (name: string) => /\(([^)]+)\)$/.exec(BY_NAME.get(name.trim().toLowerCase()) ?? "")?.[1] ?? "";
