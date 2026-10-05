// Runs once when the Next.js server starts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Keep a short history of each bot's screenshots (lib/screenshots.ts).
    const { startScreenshotArchiver } = await import("./lib/screenshots");
    startScreenshotArchiver();
    // Watch the bots for things worth a notification (lib/alerts.ts).
    const { startAlertWatcher } = await import("./lib/alerts");
    startAlertWatcher();
  }
}
