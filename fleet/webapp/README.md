# Bot dashboard (Next.js)

The family's dashboard on this Mac, at http://127.0.0.1:3000. Four entries in the menu:

- **Home (`/`):** the office world, a pixel room where each bot sits at its desk, rests or sleeps by what it is doing
  now (`app/world-view.tsx`, `lib/world.ts`). Click a member for its panel: Info, Screen (its page over the
  shoulder) and Feed, plus the owner's Pause, Stop, Start and Bring back (`/api/controls`, `lib/owner-controls.ts`).
  The bulletin board carries The CEO's proposals (`/api/ceo-proposals`) and the decisions waiting for the owner.
  A World / List switch shows the same board as cards instead (`app/family-board.tsx`).
- **Work plan (`/work-plan`):** each bot's goal and rules, past jobs, leads and checks.
- **Settings (`/settings`):** Appearance, AI providers, Notifications, Reports (the team's week and the
  Validator's reports), Remote access and About.
- **Notifications:** the bell, from `lib/alerts.ts` (started in `instrumentation.ts`).

This app lives in `~/bots/webapp`, next to the bot folders. The bot code stays in `~/Projects/bot`.

## How it gets the data

- `lib/bots.ts` finds bots by reading `~/bots/*/config.toml`; `/api/bots` lists them with a status summary from
  each bot's data server (the Work plan's status dots).
- `/api/board` (`lib/board-read.ts`, `lib/board.ts`) is the live board: each bot's newest heartbeat and today's
  actions from its own database (read-only), the tail of its `logs/explorer.jsonl`, its plan, and its STOP,
  PAUSE, RESTARTING and RETIRED.md markers.
- `/api/shoulder` reads the bot's latest trace and `screenshots/current.png` for the Screen tab.
- Old addresses (`/bots/...`, `/chatroom`, `/requests`, `/send-today`, `/family-review`) redirect to `/`
  (`lib/removed-routes.ts`).

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

## Settings

The profile button at the top right opens Settings (`/settings`):

- **Appearance:** Automatic, Light or Dark (cookie `theme`) and the Liquid Glass clear-to-tinted slider (cookie
  `glass`), both applied without a reload.
- **AI providers:** each bot's model chain from the bot code (`scripts/providers-json.py`), with key presence,
  model, free-tier note and today's usage. Test a saved key (a model list plus a one-token completion), or add
  and replace keys. Keys are written only inside `~/bots/common-data/keys` (chmod 600), never returned to the
  browser, and only from this app's own page (`lib/keys.ts`, `app/api/settings/keys`). Restart a bot after
  changing its keys.
- **Remote access:** Tailscale state, the tailnet address, what it forwards to, and who may open it.
- **Notifications:** what the bell watches for.
- **Reports:** the team's numbers and key results, the Validator's refusal report and its near-duplicate packages.
- **About:** versions, the Apple design kit's freshness with a Check now button, and the bot code's latest commit.

## Apple theme

The look follows `applebrandkit.md`: Apple's iOS 27 Liquid Glass design translated to the web (system colors,
Dynamic Type sizes, glass toolbar and tab bar, Home Screen support). Tokens and glass utilities live in
`app/globals.css`; shared pieces in `app/ui.tsx` and `app/page-shell.tsx`.

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
names. Everyone else gets "Not allowed". The owner's controls and every save also require the page's
own origin (`lib/same-origin.ts`). Undo remote access with `tailscale serve reset`.
