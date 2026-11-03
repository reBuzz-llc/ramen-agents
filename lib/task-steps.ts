// The queue's status steps for a task: client-safe, so the card can import it without the store.
export const STEPS = ["Not started", "In progress", "In Review", "Done"] as const;
