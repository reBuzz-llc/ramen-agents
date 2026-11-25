// Runs once as the server starts, before it answers anything. The check for sign-in off lives in lib/local-start.ts and
// is loaded only on the Node.js runtime, the one `next start` serves pages on.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { localStart } = await import("./lib/local-start");
    await localStart();
  }
}
