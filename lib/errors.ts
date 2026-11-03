// What a page may say when something fails. A message written for a person (ShownError, or Notion's refusal) is shown
// as is; anything else -- a failed query with its SQL and parameters, a stack -- goes to the server log only, and the
// page says it failed on our side.
import { NotionError } from "./notion";

export class ShownError extends Error {}

export const OUR_SIDE = "Something failed on our side; it's logged. Try again in a minute.";

export function publicReason(err: unknown, where: string): string {
  if (err instanceof ShownError || err instanceof NotionError) return err.message;
  console.error(`[${where}]`, err);
  return OUR_SIDE;
}
