/** Phone numbers: stored in E.164
 *  ("+17188760861") whoever writes them. A US number may come in any common shape ("(718) 876-0861", "718.876.0861",
 *  "1 718 876 0861"); a number with a country code keeps it. Anything that is not a phone number is kept as written,
 *  so nothing a person or a bot typed is lost. */
export function e164(raw: string): string {
  const s = raw.trim();
  const ext = /\s*(?:ext\.?|x|#)\s*\d+$/i.exec(s);
  const main = ext ? s.slice(0, ext.index) : s;
  if (/[^\d\s()+.\-/]/.test(main)) return s;
  const digits = main.replace(/\D/g, "");
  if (main.startsWith("+"))
    return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : s;
  if (main.startsWith("00") && digits.length >= 10 && digits.length <= 17)
    return `+${digits.slice(2)}`;
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`;
  if (
    digits.length === 11 &&
    digits.startsWith("1") &&
    /^[2-9]/.test(digits.slice(1))
  )
    return `+${digits}`;
  return s;
}

/** A tel: link for a stored number, or null when it is not one. */
export function telHref(v: string): string | null {
  const n = e164(v);
  return /^\+\d{8,15}$/.test(n) ? `tel:${n}` : null;
}
