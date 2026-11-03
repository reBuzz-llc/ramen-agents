// Settings > Appearance: light, dark or the device's own setting, and the text size; kept in this
// browser's cookies (a choice of how this screen looks, not company data), read by the root layout into <html>.
export const THEMES = [
  { value: "system", label: "Same as this device" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;
export const TEXT_SIZES = [
  { value: "standard", label: "Standard" },
  { value: "large", label: "Larger (about 12% bigger)" },
] as const;
export type Theme = (typeof THEMES)[number]["value"];
export type TextSize = (typeof TEXT_SIZES)[number]["value"];
export const THEME_COOKIE = "peek-theme";
export const TEXT_COOKIE = "peek-text";

export const themeOf = (v: string | undefined): Theme => (THEMES.some((t) => t.value === v) ? (v as Theme) : "system");
export const textOf = (v: string | undefined): TextSize => (TEXT_SIZES.some((t) => t.value === v) ? (v as TextSize) : "standard");

/** The attributes the root layout puts on <html>: data-theme only for a chosen theme (the CSS follows the device
 *  otherwise), data-text only for the larger size. */
export function htmlAttrs(theme: string | undefined, text: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const t = themeOf(theme);
  if (t !== "system") out["data-theme"] = t;
  if (textOf(text) === "large") out["data-text"] = "large";
  return out;
}
