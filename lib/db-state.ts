// What a failed database call means: "quota" when Neon refuses connections because the
// project's free allowance is used up ("Your account or project has exceeded the quota", the 53xxx class), else "down".
export function dbState(err: unknown): "quota" | "down" {
  const e = err as { message?: string; code?: string; cause?: { message?: string; code?: string } } | null;
  const text = `${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
  const code = `${e?.code ?? ""}${e?.cause?.code ?? ""}`;
  return /exceeded the (data transfer |compute time )?quota|quota exceeded/i.test(text) || /^53/.test(code) ? "quota" : "down";
}
