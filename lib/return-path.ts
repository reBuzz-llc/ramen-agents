// Where to go after sign-in: a signed-out visit to a deep link (/tasks/<id>, /leads/<id>,
// /leads/import, /files) carries its path as ?next= through sign-in (Google's callbackURL, or the development form)
// and the notice step, and lands there. Only a path on this site is kept: never another host ("//x", "/\x", a scheme),
// never the sign-in or welcome steps themselves, never the API; anything else falls back to the default.
export function safeNext(v: unknown): string | null {
  if (typeof v !== "string" || v.length > 500) return null;
  if (!/^\/(?![/\\])/.test(v) || /[\u0000-\u001f\\]/.test(v)) return null;
  if (/^\/(sign-in|welcome|no-access|api)(\/|\?|#|$)/.test(v)) return null;
  try {
    // a path that parses to another origin (any trick left) is refused
    if (new URL(v, "https://peek.invalid").origin !== "https://peek.invalid") return null;
  } catch {
    return null;
  }
  return v;
}

/** "/sign-in?next=%2Ftasks%2F…" (or the bare step when there is nothing to return to). */
export const withNext = (step: "/sign-in" | "/welcome", next: string | null | undefined) => (next && safeNext(next) ? `${step}?next=${encodeURIComponent(next)}` : step);
