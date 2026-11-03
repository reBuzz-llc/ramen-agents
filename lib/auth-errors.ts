// What the sign-in form says when Neon Auth refuses. Neon's client throws some refusals (an AuthApiError with a message
// and a code) and returns others as {error}; both arrive here. Known codes get plain words; anything else shows Neon's
// own message, and nothing is ever swallowed.

const WORDS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "That email and password don't match an account. Check both, or create your account first.",
  USER_ALREADY_EXISTS: "There is already an account with this email: sign in instead (or use Google with the same address).",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "There is already an account with this email: sign in instead (or use Google with the same address).",
  PASSWORD_TOO_SHORT: "The password needs at least 8 characters.",
  PASSWORD_TOO_LONG: "That password is too long.",
  INVALID_EMAIL: "That is not an email address.",
  INVALID_OTP: "That code is not right. Check the newest email, or send the code again.",
  OTP_EXPIRED: "That code has expired. Send the code again.",
  TOO_MANY_ATTEMPTS: "Too many tries. Wait a minute, then send the code again.",
};

function codeOf(err: unknown): string {
  const e = err as { code?: unknown; error?: { code?: unknown }; body?: { code?: unknown } } | null;
  return String(e?.code ?? e?.error?.code ?? e?.body?.code ?? "");
}

export function authMessage(err: unknown): string {
  const code = codeOf(err);
  if (WORDS[code]) return WORDS[code];
  const e = err as { message?: unknown; status?: unknown; statusText?: unknown } | null;
  const status = Number(e?.status);
  if (status === 429) return "Too many tries. Wait a minute and try again.";
  if (/invalid origin|invalid domain/i.test(String(e?.message ?? ""))) return "This address is not on the sign-in service's list of allowed sites. Tell the owner: Neon Console → Auth → Domains.";
  const msg = typeof e?.message === "string" && e.message.trim() ? e.message.trim() : "";
  if (msg) return msg.endsWith(".") ? msg : `${msg}.`;
  if (err instanceof TypeError) return "No answer from the sign-in service. Check your connection and try again.";
  return "The sign-in service refused, without saying why. Try again in a minute.";
}

