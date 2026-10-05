import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { BOTS_DIR, listBots } from "@/lib/bots";

// Open the bot viewed last, or the first one found.
export default async function Home() {
  const [bots, jar] = await Promise.all([listBots(), cookies()]);
  if (bots.length > 0) {
    const last = jar.get("bot")?.value;
    redirect(`/bots/${bots.find((b) => b.slug === last)?.slug ?? bots[0].slug}`);
  }
  return (
    <main className="mx-auto max-w-xl px-4 pt-[calc(env(safe-area-inset-top)+6rem)] pb-24 text-center">
      <h1 className="text-3xl font-bold">No bots yet</h1>
      <p className="mt-2 text-sm text-muted">
        Nothing with a config.toml was found in {BOTS_DIR}. Create one from the bot checkout:
      </p>
      <pre className="mt-4 overflow-x-auto rounded-xl bg-panel px-4 py-3 text-left font-mono text-xs">
        .venv/bin/bot new &quot;My Bot&quot; --persona explorer --port 8789
      </pre>
    </main>
  );
}
