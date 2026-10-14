import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CODE_ROOT } from "@/lib/bots";
import { SettingsPage } from "../../settings-ui";
import { Badge, Panel } from "../../ui";
import CheckNow from "./check-now";

export const metadata = { title: "About · Settings" };
export const dynamic = "force-dynamic";

const run = promisify(execFile);

async function version(pkg: string): Promise<string> {
  try {
    return JSON.parse(await readFile(path.join(process.cwd(), "node_modules", pkg, "package.json"), "utf8")).version;
  } catch {
    return "?";
  }
}

async function kitStatus() {
  try {
    const md = await readFile(path.join(process.cwd(), "applebrandkit.md"), "utf8");
    const field = (k: string) => md.match(new RegExp(`^${k}: (.*)$`, "m"))?.[1]?.trim() ?? "?";
    const status = md.slice(md.indexOf("<!-- brandkit:status:start"), md.indexOf("<!-- brandkit:status:end"));
    const verdict = status.match(/\*\*Verdict:\*\* (.*)/)?.[1] ?? "?";
    const checked = status.match(/\*\*Last checked:\*\* (.*)/)?.[1] ?? "?";
    const changes = [...status.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1]).filter((c) => !/^(Last checked|Kit last reviewed|Apple's latest|Verdict)/.test(c));
    const packages = [...status.matchAll(/^\| ([@\w./-]+) \| ([\d.]+) \| ([\d.]+) \| (.+?) \|$/gm)].map((m) => ({ name: m[1], current: m[2], latest: m[3], kind: m[4] }));
    return { version: field("version"), baseline: field("apple_baseline"), reviewed: field("last_reviewed"), verdict, checked, changes, packages };
  } catch {
    return null;
  }
}

async function botCode() {
  try {
    const { stdout } = await run("/usr/bin/git", ["-C", CODE_ROOT, "log", "-1", "--format=%h|%s|%cr"], { timeout: 5000 });
    const [hash, subject, when] = stdout.trim().split("|");
    return { hash, subject, when };
  } catch {
    return null;
  }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 text-sm">
      <span className="text-muted">{label}</span>
      <span className="min-w-0 text-right text-ink">{children}</span>
    </div>
  );
}

export default async function AboutPage() {
  const [pkg, next, react, tailwind, kit, code] = await Promise.all([
    readFile(path.join(process.cwd(), "package.json"), "utf8").then((t) => JSON.parse(t) as { name: string; version: string }),
    version("next"),
    version("react"),
    version("tailwindcss"),
    kitStatus(),
    botCode(),
  ]);
  const ok = kit?.verdict.includes("Up to date");
  return (
    <SettingsPage title="About" subtitle="Versions, design kit and where things live">
      <Panel title="Dashboard">
        <div className="divide-y divide-line">
          <Row label="Version">{pkg.version}</Row>
          <Row label="Next.js · React · Tailwind">
            <span className="font-mono text-xs">
              {next} · {react} · {tailwind}
            </span>
          </Row>
          <Row label="Runs as">
            <span className="font-mono text-xs">com.ramen-agents.bot-dashboard</span>
          </Row>
          <Row label="Logs">
            <span className="font-mono text-xs">~/bots/webapp/logs</span>
          </Row>
        </div>
      </Panel>

      {kit ? (
        <Panel title="Apple design kit" aside={<Badge tone={ok ? "good" : "warn"}>{ok ? "Up to date" : "Review needed"}</Badge>}>
          <div className="divide-y divide-line">
            <Row label="Follows">{kit.baseline}</Row>
            <Row label="Kit version">{kit.version}</Row>
            <Row label="Last reviewed">{kit.reviewed}</Row>
            <Row label="Last checked">{kit.checked}</Row>
          </div>
          {kit.changes.length ? (
            <ul className="mt-2 space-y-1 text-sm text-ink">
              {kit.changes.map((c) => (
                <li key={c}>• {c}</li>
              ))}
            </ul>
          ) : null}
          {kit.packages.length ? (
            <p className="mt-2 text-xs text-muted">
              Package updates: {kit.packages.map((p) => `${p.name} ${p.current} → ${p.latest}`).join(", ")}
            </p>
          ) : null}
          <div className="mt-3">
            <CheckNow />
          </div>
          <p className="mt-2 text-xs text-muted">Also checked before every deploy and every Monday at 09:00. Details in ~/bots/webapp/applebrandkit.md.</p>
        </Panel>
      ) : null}

      {code ? (
        <Panel title="Bot code">
          <div className="divide-y divide-line">
            <Row label="Folder">
              <span className="font-mono text-xs">~/Projects/bot</span>
            </Row>
            <Row label="Latest commit">
              <span className="font-mono text-xs">{code.hash}</span> · {code.when}
            </Row>
            <Row label="Message">{code.subject}</Row>
            <Row label="Folder">
              <span className="font-mono text-xs">~/Projects/bot</span>
            </Row>
          </div>
        </Panel>
      ) : null}
    </SettingsPage>
  );
}
