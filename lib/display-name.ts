// A person's name as Peek shows and records it: their name, else the part of their email before the
// @ (not the whole address, which a missing name used to put on packs, Sent by, statements and This week). Settings →
// People warns about a missing name. Pure (client components use it too); the list reads write the same rule in SQL:
// coalesce(nullif(trim(name), ''), split_part(email, '@', 1)).

/** "Sampada Adhikary", or "sampada" for sampada@example.com when no name is set. */
export function displayName(name: string | null | undefined, email: string | null | undefined): string {
  const n = (name ?? "").trim();
  if (n) return n;
  const e = (email ?? "").trim();
  return e.includes("@") ? e.slice(0, e.indexOf("@")) : e;
}

/** The names a person's own records may carry: the shown name, and the full address older records were written under. */
export const namesOf = (name: string | null | undefined, email: string | null | undefined): string[] => [...new Set([displayName(name, email), (email ?? "").trim()].filter(Boolean))];
