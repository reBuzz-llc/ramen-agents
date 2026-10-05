import { remoteStatus } from "@/lib/remote";
import CopyButton from "../../copy-button";
import { SettingsPage } from "../../settings-ui";
import { Badge, Panel } from "../../ui";

export const metadata = { title: "Remote access · Settings" };
export const dynamic = "force-dynamic";

const STATE = {
  running: { tone: "good", label: "Connected" },
  stopped: { tone: "warn", label: "Tailscale is off" },
  "needs-login": { tone: "warn", label: "Not signed in" },
  "not-installed": { tone: "bad", label: "Tailscale not installed" },
  unknown: { tone: "muted", label: "Unknown" },
} as const;

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 text-right text-ink">{children}</span>
    </div>
  );
}

export default async function RemotePage() {
  const r = await remoteStatus();
  const st = STATE[r.state];
  const reachable = r.state === "running" && r.url && r.forwarding;
  return (
    <SettingsPage title="Remote access" subtitle="Open the dashboard from your iPhone or another computer">
      <Panel title="Status" aside={<Badge tone={st.tone}>{st.label}</Badge>}>
        <div className="divide-y divide-line">
          <Row label="Address">
            {r.url ? (
              <span className="inline-flex items-center gap-1 font-mono text-xs break-all">
                {reachable ? (
                  <a href={r.url} className="text-accent hover:underline">
                    {r.url}
                  </a>
                ) : (
                  r.url
                )}
                <CopyButton text={r.url} what="address" />
              </span>
            ) : (
              <span className="text-muted">not set up</span>
            )}
          </Row>
          <Row label="Forwards to">{r.forwarding ? <span className="font-mono text-xs">{r.forwarding}</span> : <span className="text-muted">nothing</span>}</Row>
          <Row label="Who may open it">{r.allowed.length ? r.allowed.join(", ") : <span className="text-muted">only this Mac</span>}</Row>
          <Row label="This Mac on Tailscale">{r.dnsName ?? <span className="text-muted">unknown</span>}</Row>
          {r.version ? <Row label="Tailscale version">{r.version}</Row> : null}
        </div>
        {reachable ? <p className="mt-3 text-sm text-muted">Open the address on any device signed in to your Tailscale account. Everyone else gets “Not allowed”.</p> : null}
      </Panel>

      {!reachable ? (
        <Panel title="Turn it on" hint="Traffic goes through Tailscale's encrypted network; the dashboard never listens on the internet.">
          <ol className="list-decimal space-y-2 pl-5 text-sm text-ink">
            {r.state === "not-installed" ? <li>Install Tailscale from tailscale.com/download/mac and sign in.</li> : null}
            {r.state === "stopped" || r.state === "needs-login" || r.state === "unknown" ? <li>Open the Tailscale app in the menu bar and turn it on (sign in if it asks).</li> : null}
            {!r.url || !r.forwarding ? (
              <li>
                In Terminal, set up the address:
                <span className="mt-1.5 flex items-center gap-2 rounded-lg bg-grouped-3 px-3 py-2">
                  <code className="min-w-0 flex-1 overflow-x-auto font-mono text-xs whitespace-nowrap">cd ~/bots/webapp && npm run remote-access</code>
                  <CopyButton text="cd ~/bots/webapp && npm run remote-access" what="command" />
                </span>
              </li>
            ) : (
              <li>The address is already set up; it works again as soon as Tailscale is on.</li>
            )}
            <li>Install Tailscale on your iPhone, sign in with the same account, and open the address.</li>
          </ol>
        </Panel>
      ) : null}

      <Panel title="On your iPhone" hint="Make it feel like an app.">
        <p className="text-sm text-ink">In Safari, open the address, tap Share, then Add to Home Screen. It opens full-screen with its own icon.</p>
      </Panel>
    </SettingsPage>
  );
}
