// A person once saved a login and its password in clear on the Asset page, which every
// signed-in person and every key that reads /v1/assets/sections can read. When a section about to be saved looks like a
// login, the page warns and asks to save anyway: never a block, and only that one check at save (nothing already there
// is scanned). Pure.

export const LOGIN_WARNING = "Do not keep passwords on this page: everyone on the team can read it.";

const WORDS = /\b(pass(?:word|wd|code|phrase)s?|pwd|credentials?|log-?in(?:\s+details)?|sign-?in\s+details)\b/i;
// "user: x … password: y", "email = x … pin = 1234"
const PAIR = /\b(?:user(?:name)?|e-?mail|login|account|id)\s*[:=]\s*\S+[\s\S]{0,120}?\b(?:pass(?:word)?|pwd|secret|pin|key)\s*[:=]\s*\S+/i;
// "someone@example.com / s3cret!" (an address, a slash, a secret-looking word)
const SLASHED = /\b[\w.+-]+@[\w-]+\.[\w.-]+\s*\/\s*\S{4,}/;

/** Whether a section's title or body looks like a login (a password word, a user and secret pair, an address / secret). */
export function looksLikeLogin(title: string, body: string): boolean {
  const text = `${title}\n${body}`;
  return WORDS.test(text) || PAIR.test(text) || SLASHED.test(text);
}
