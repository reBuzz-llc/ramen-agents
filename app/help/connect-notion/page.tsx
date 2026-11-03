import Link from "next/link";

export const metadata = { title: "Connect your Notion · ramen-agents" };

// The guide for a person who has never made a Notion integration. Each step has a drawn picture of where to click
// (drawn, not a screenshot, so it does not go stale with every Notion redesign or show anyone's workspace).

function Path({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-sm">
      {items.map((s, i) => (
        <span key={s} className="flex items-center gap-1.5">
          {i ? <span className="text-muted">→</span> : null}
          <span className="rounded-md border border-line bg-bg px-2 py-0.5">{s}</span>
        </span>
      ))}
    </div>
  );
}

function Picture({ children, caption }: { children: React.ReactNode; caption: string }) {
  return (
    <figure className="mt-3 rounded-xl border border-line bg-panel p-4">
      {children}
      <figcaption className="mt-3 text-xs text-muted">{caption}</figcaption>
    </figure>
  );
}

export default function ConnectNotion() {
  return (
    <article className="max-w-2xl space-y-10">
      <header>
        <Link href="/settings/board" className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-accent-ink hover:underline">
          ← Settings › Board
        </Link>
        <h1 className="text-2xl font-bold tracking-tight sm:text-[1.75rem]">Connect your Notion</h1>
        <p className="mt-2 text-muted">
          Three steps, about five minutes. You make a private key (a &quot;token&quot;) in Notion, let it see your Leads board,
          and paste it into ramen-agents. You need to be an owner of the Notion workspace to make the token.
        </p>
      </header>

      <section>
        <h2 className="text-lg font-semibold">1. Make a token in Notion</h2>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm">
          <li>In Notion, open <b>Settings</b> (left sidebar), then <b>Connections</b>.</li>
          <li>Click <b>Develop or manage integrations</b>. A new page opens.</li>
          <li>
            Click <b>New integration</b>. Name it &quot;ramen-agents&quot;, pick your workspace, and leave the type as <b>Internal</b>. Save.
          </li>
          <li>
            On the integration&apos;s page, under <b>Internal integration secret</b>, click <b>Show</b> and then <b>Copy</b>. It starts
            with <code>ntn_</code> (older ones start with <code>secret_</code>).
          </li>
        </ol>
        <Picture caption="Drawn: where to click in Notion. The secret is like a password: paste it only into ramen-agents.">
          <Path items={["Settings", "Connections", "Develop or manage integrations", "New integration", "Internal", "Show → Copy"]} />
          <div className="mt-3 rounded-lg border border-line bg-bg p-3 font-mono text-xs">
            Internal integration secret
            <div className="mt-1 flex items-center justify-between rounded border border-line bg-panel px-2 py-1">
              <span>ntn_••••••••••••••••••••••••</span>
              <span className="text-accent-ink">Copy</span>
            </div>
          </div>
        </Picture>
      </section>

      <section>
        <h2 className="text-lg font-semibold">2. Let it see your Leads board</h2>
        <p className="mt-2 text-sm">
          A new integration sees nothing until you share a board with it. Open your <b>Leads board</b> in Notion, click{" "}
          <b>···</b> at the top right, then <b>Connections</b>, and add &quot;ramen-agents&quot;. Do the same for your task
          board if you have one.
        </p>
        <Picture caption="Drawn: the ··· menu at the top right of the board, then Connections.">
          <div className="flex justify-end">
            <div className="w-56 rounded-lg border border-line bg-bg p-2 text-sm shadow-sm">
              <div className="mb-1 text-right font-bold">···</div>
              <div className="rounded px-2 py-1 text-muted">Copy link</div>
              <div className="rounded bg-panel px-2 py-1 font-semibold">Connections →</div>
              <div className="ml-4 mt-1 rounded border border-line bg-panel px-2 py-1">+ ramen-agents</div>
            </div>
          </div>
        </Picture>
      </section>

      <section>
        <h2 className="text-lg font-semibold">3. Paste it here and pick your boards</h2>
        <p className="mt-2 text-sm">
          In ramen-agents, go to <Link href="/settings/board" className="text-accent-ink underline">Settings</Link> → Board.
          Paste the token, click <b>Find my boards</b>, choose your <b>Leads board</b> (and your task board, if you have one),
          and click <b>Connect</b>. Each board shows a few of its column names so you can tell them apart.
        </p>
        <Picture caption="Drawn: the Notion box in Settings.">
          <div className="space-y-2 text-sm">
            <div className="flex gap-2">
              <span className="flex-1 rounded border border-line bg-bg px-2 py-1 font-mono text-xs">ntn_••••••••</span>
              <span className="rounded-full border border-line px-3 py-1 text-xs">Find my boards</span>
            </div>
            <div className="rounded border border-line bg-bg px-2 py-1">Leads (looks like Leads) ▾</div>
            <div className="text-xs text-muted">Business, Status, Draft email, Lead score, …</div>
            <span className="inline-block rounded-full bg-accent px-3 py-1 text-xs font-semibold text-on-accent hover:bg-accent-hover">Connect</span>
          </div>
        </Picture>
        <p className="mt-3 text-sm">
          Once connected, Settings shows a card with the board names, the last refresh and how many rows are in the queue.
          The token is stored encrypted, and ramen-agents only ever changes a row&apos;s Status, when someone clicks.
        </p>
      </section>

      <section>
        <h2 className="text-lg font-semibold">If your board is not in the list</h2>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          <li>It has not been shared with the integration yet: do step 2 for that board.</li>
          <li>
            Or paste the board&apos;s link instead. In Settings, open <b>advanced: paste an id or a Notion link</b>. In Notion,
            open the board, click <b>···</b> → <b>Copy link</b>, and paste it whole.
          </li>
        </ul>
        <Picture caption="Where the id sits in a board's link: the 32 letters and digits after the board's name, before any ?v=.">
          <p className="break-all font-mono text-xs">
            https://www.notion.so/yourteam/Leads-<mark className="rounded bg-accent/20 px-0.5 text-ink">1a2b3c4d5e6f40718293a4b5c6d7e8f9</mark>?v=…
          </p>
        </Picture>
      </section>

      <section>
        <h2 className="text-lg font-semibold">The columns Our queue reads</h2>
        <p className="mt-2 text-sm">
          Your Leads board needs a <b>Status</b> column (with the options &quot;Ready to Send Email&quot; and &quot;Email
          Sent&quot;) and a <b>Draft email</b> column. Without them it still connects, but Our queue stays empty, and Settings
          says which column is missing.
        </p>
      </section>
    </article>
  );
}
