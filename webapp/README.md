# Bot dashboard (Next.js)

A read-only page for every bot on this Mac. The name in the top-left corner is a profile switcher:
it lists each bot under `~/bots` with a live status dot, and each bot has its own address,
`/bots/<folder-name>`. The home page opens the bot you viewed last.

Each bot page shows status, the current question and page, what it runs on this Mac, the latest
screenshot, the live activity log, notes, open questions, interests, and today's journal.

This app lives in `~/bots/webapp`, next to the bot folders. The bot code stays in `~/Projects/bot`.

## How it gets the data

- `lib/bots.ts` finds bots by reading `~/bots/*/config.toml` (name, bio, `[dashboard] port`).
- `/api/bots` lists them with a status summary.
- `/api/bots/<slug>/<endpoint>` forwards GET requests to that bot's own data server
  (`bot dashboard`, `src/explorer/dashboard.py`). No write endpoints are forwarded, so this app
  cannot chat with a bot through its data server.
- `POST /api/bots/<slug>/control` with `{"op": "run" | "stop"}` backs the Run and Stop buttons
  (`lib/control.ts`). Stop writes the bot's STOP file, like `bot stop`, so launchd keeps it down.
  Run clears STOP and PAUSE, then starts the bot with `launchctl kickstart` when it has a launch
  agent, or as a detached `bot --config <config> run --quiet` when it is run by hand (log in
  `workspace/logs/manual.out`). It only accepts JSON from this app's own page on 127.0.0.1.
- `/bots/<slug>/persona` edits the bot's bio (`[agent] bio` in config.toml), its goals and its
  persona (`persona.md`), through `GET` and `PUT /api/bots/<slug>/persona` (`lib/persona.ts`). Goals
  are the persona's `## ...goal...` section, or a new `## Goals` section at the end. A save refuses to
  overwrite a file that changed since the page loaded, and keeps the previous version in
  `workspace/backups/`. A bot reads its persona only when it starts, so the page offers a restart.
- Screenshot history: a bot keeps only `workspace/screenshots/current.png`. While this app runs,
  `lib/screenshots.ts` (started from `instrumentation.ts`) copies each new version into
  `workspace/screenshots/history/` with the page address, keeping the newest 50
  (`SCREENSHOT_HISTORY_MAX`). `/api/bots/<slug>/screenshots` lists them for Previous / Next.
- `/api/bots/<slug>/machine` is answered by this app itself (`lib/machine.ts`). It reads `ps`,
  `lsof` and `lsappinfo` to show the bot's browser (Chromium through Playwright, or the Tor text
  reader), its agent, supervisor, driver and data server processes, whether it is connected to
  Ollama or Tor right now, the app in front, and the quiet-mode apps. Raw command lines are never
  sent to the page.

## Run it

The dashboard runs as a launch agent, `com.ramen-agents.bot-dashboard`: the production build on
http://127.0.0.1:3000, started at login and restarted if it stops. Logs are in `logs/`.

```sh
cd ~/bots/webapp
npm run deploy    # after changing the code: build, then restart the service
npm run bots      # start any bot data servers that are not running (they are not started at login)
```

For development, stop the service first (`launchctl bootout gui/$(id -u)/com.ramen-agents.bot-dashboard`),
run `npm run dev`, and bootstrap the plist again when done.

Every bot needs its own `[dashboard] port`; `bot new NAME --persona explorer|ceo --port N` sets one.
`BOTS_DIR` and `BOT_CODE_ROOT` override `~/bots` and `~/Projects/bot`.

## Team (Persona page, bots with Notion)

Who a bot may assign Notion tasks to. The panel lists the people in the Notion workspace (read with
the integration token in `common-data/keys/notion.key`, on the server only; Notion's API does not list
guests) and saves the chosen ones, with a role and details each and one default, to
`common-data/team.json`. Every bot with `[notion] enabled` reads that file at each new episode
(`src/explorer/team.py`), so a change takes effect without a restart: the model is shown the list,
a task naming anyone else is refused, and an unassigned task goes to the default person.
`TEAM_FILE` overrides the path (tests).

## Settings

The profile button at the top right opens Appearance and Settings (`/settings`):

- **Appearance:** Automatic, Light or Dark (cookie `theme`) and the Liquid Glass clear-to-tinted slider (cookie
  `glass`), both applied without a reload.
- **AI providers:** each bot's model chain from the bot code (`scripts/providers-json.py`), with key presence,
  model, free-tier note and today's usage. Test a saved key (a model list plus a one-token completion), or add
  and replace keys. Keys are written only inside `~/bots/common-data/keys` (chmod 600), never returned to the
  browser, and only from this app's own page (`lib/keys.ts`, `app/api/settings/keys`). Restart a bot after
  changing its keys.
- **Remote access:** Tailscale state, the tailnet address, what it forwards to, and who may open it.
- **About:** versions, the Apple design kit's freshness with a Check now button, and the bot code's latest commit.

## Apple theme

The look follows `applebrandkit.md`: Apple's iOS 27 Liquid Glass design translated to the web (system colors,
Dynamic Type sizes, glass toolbar and tab bar, Home Screen support). Tokens and glass utilities live in
`app/globals.css`; shared pieces in `app/ui.tsx` and `app/app-chrome.tsx`.

The kit keeps itself current. `npm run brandkit:check` reads Apple's design updates, the guideline pages the
kit depends on, Apple Developer news, the WebKit blog and `npm outdated`, and rewrites the kit's status
section. It runs before every `npm run deploy` and weekly (launch agent `com.ramen-agents.brandkit-check`, Mondays
09:00, with a macOS notification when something needs review). After updating the kit and theme for a
change, run `npm run brandkit:accept`.

## Open it from your phone or another computer

It is not on the internet, and it cannot run on Vercel: it reads ~/bots, inspects this Mac's processes
and starts bots through launchd. Other devices reach it through Tailscale instead.

1. Install Tailscale on this Mac (https://tailscale.com/download/mac) and on your phone or laptop, and
   sign in to the same account on both.
2. On this Mac: `npm run remote-access`. It runs `tailscale serve` (HTTPS on this Mac's tailnet name,
   forwarded to 127.0.0.1:3000) and prints the address, `https://<mac>.<tailnet>.ts.net/`.

Who may use it (`proxy.ts`, `lib/access.ts`): requests from this Mac, and forwarded requests whose
`Tailscale-User-Login` is the account this Mac is signed in with. Set `DASHBOARD_ALLOWED_USERS`
(comma-separated logins) in the launch agent to allow others, and `DASHBOARD_HOSTS` for extra host
names. Everyone else gets "Not allowed". Run, Stop, Restart and persona saves also require the page's
own origin (`lib/same-origin.ts`). Undo remote access with `tailscale serve reset`.
