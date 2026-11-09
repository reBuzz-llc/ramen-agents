// The lead's sample site: the team makes a one-page sample by hand before the
// meeting and pastes its link into the lead's "Sample site" cell. A copied draft or WhatsApp message then ends with the
// link, unless the text already has it. Pure, so the pack cards, the drawer and the store share it.

/** An https link with a host: what the Sample site cell takes. */
export function isSampleUrl(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" && !!u.hostname && u.hostname.includes(".");
  } catch {
    return false;
  }
}

/** The text with "Your sample site: <url>" at its end when the lead has a sample and the text does not carry it. */
export function withSample(text: string, url: string | null | undefined): string {
  const link = (url ?? "").trim();
  if (!link || text.includes(link)) return text;
  return `${text.trimEnd()}\n\nYour sample site: ${link}`;
}
