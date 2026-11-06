/** A copied draft names its attachments at the end, so whoever sends by hand knows what to attach. One
 *  helper for the drawer's Copy, Leads → Send next and Our queue's Copy draft. */
export const withAttachments = (draft: string, names: string[] = []) =>
  names.length
    ? `${draft.trimEnd()}\n\nAttachments: ${names.join(", ")}`
    : draft;
