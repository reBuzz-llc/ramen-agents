# Explorer

> Engine starter: the `bot` program with no history and no project data. This is the `engine` branch of the starter,
> cloned to `~/Projects/bot`; the `fleet` branch holds the bots it runs and is cloned to `~/bots`. Start with the
> fleet branch's SETUP.md. Names, places and businesses in the
> tests and comments are fictional.

A curiosity-driven local agent. It roams the web with a local model, takes notes, asks itself
questions, and writes a daily journal. Nobody assigns it tasks. See `explorer.md` for the design
and `bot.md` for the original spec.

## What it needs

- macOS, Python 3.11+, Ollama running on `localhost:11434` with the configured model pulled.
- The `.venv` in this folder (`python3 -m venv .venv && .venv/bin/pip install -e ".[dev]"`).
- Chromium for Playwright (`.venv/bin/playwright install chromium`), started only for pages that need it.

## Commands

All commands read `config.toml` in this folder. Use `bot --config <path>` for another one. A bot's
config can start with `extends = "../common-data/configs/web-bots.toml"` to pull in the settings every
bot shares; its own values win.

| Command | What it does |
|---|---|
| `bot check` | verify SQLite FTS5, workspace, denylist, Ollama, Chromium |
| `bot init` | create the workspace and database, seed interests |
| `bot run` | run forever (Ctrl-C to stop) |
| `bot run --cycles 20 --mode fake --model fake` | offline dry run on the local fake web |
| `bot run --mode web --model ollama --cycles 10` | ten real cycles with the local model |
| `bot status` | latest heartbeat, counts, open episode |
| `bot tail -n 50` | last log lines |
| `bot journal` | print today's journal |
| `bot pause` / `bot resume` | hold the loop without losing state, then release |
| `bot stop` | kill switch: the agent exits within a second and stays down |
| `bot dashboard` | serve the watch-and-chat page on `http://127.0.0.1:8787` (add `--open` to launch the browser) |

`bot` lives at `.venv/bin/bot`, or run `.venv/bin/python -m explorer`.

## Watching it and talking to it

`bot dashboard` runs beside the agent (it is a separate process) and shows, refreshing every few
seconds: a picture of the page the agent is on, its current question and last action, a live feed of
actions with the model's thoughts and any refusals, its notes, questions, interests and journal, and
Pause / Resume / Stop buttons.

The Chat panel talks to the same local model with the agent's memory as context. A plain message gets
a reply there and is also shown to the running agent on its next cycle as "Owner says", so it can act
on suggestions or answer with its `say` action. Commands are handled by code, not the model:
`/ask <question>`, `/interest <topic> [delta]`, `/pause`, `/resume`, `/stop`, `/help`.

This is the per-bot page served from this repo. The fleet web dashboard (Next.js) lives in
`~/bots/webapp`, runs as launch agent `com.rebuzz.bot-dashboard`, and is reachable remotely only
through Tailscale.

The page binds to this machine only. Every write (chat, controls) needs a token that is generated
when the dashboard starts and written to `workspace/dashboard.token`, so a web page the agent visits
cannot drive it. The agent's browser also refuses to let page scripts reach localhost or private
addresses.

## Before going online

- Set `agent.contact` in `config.toml` if you want site owners to be able to reach you; it goes into the browser user agent. Leave it empty to stay anonymous.
- Search uses keyless engines, in order: `marginalia`, `wikipedia`, `hn` (plus `corpus`, the owner's own `raw/` folder, when listed in `browser.search_engines`). Wikipedia refuses bots without `agent.contact`. The Tor backend searches its local onion directory instead.
- API keys are read from the env var (e.g. `GROQ_API_KEY`) or from `~/bots/common-data/keys/<name>.key` (`EXPLORER_KEYS_DIR` moves the folder); never from the config.
- robots.txt is honoured; a site that refuses plain HTTP clients is asked again through Chromium.

## Modes

- `mode = "fake"` browses only the HTML files under `workspace/fake_web`. Nothing leaves the machine.
- `mode = "web"` reads the real web through `browser.backend`: `"light"` (default) is a plain HTTP fetch with Chromium (its own empty profile under `workspace/browser_profile`) only for pages that need it; `"chromium"` uses Chromium for every page; `"tor"` is text only over Tor.
- `provider = "fake"` is a deterministic heuristic; `provider = "ollama"` is the local model; `"gemini"` is Google's free tier; `"remote"` tries `model.provider_chain` (`"gemini"` or `[model.providers.<name>]` OpenAI-compatible tables) in order with Ollama as the fallback.

## Safety switches

- `workspace/STOP` stops the agent and keeps it stopped, even under launchd.
- `workspace/PAUSE` holds it; delete the file to continue.
- `workspace/denylist.txt` blocks login, account, and payment pages. Private networks and non-http schemes are always blocked.
- The action vocabulary has no download, form submission, or shell. Text on web pages is data, never instructions.
- A search engine that answers with a bot-verification page is never "solved": the page counts as unreachable and searching pauses for `policy.search_cooldown_minutes`.
- `policy.pages_per_hour` and `policy.per_domain_delay_seconds` keep it a polite visitor. robots.txt is respected.

## Files it writes

- `workspace/explorer.sqlite3` notes, questions, interests, visits, episodes, actions, heartbeat
- `workspace/journal/YYYY-MM-DD.md` the journal, in the agent's own words
- `workspace/interests.md`, `workspace/questions.md` human-readable mirrors
- `workspace/logs/explorer.jsonl` structured log (rotated at 5 MB, five files kept)
- `workspace/screenshots/current.png` the page it is on, for the dashboard (Chromium pages only; `dashboard.screenshots = false` to skip)
- `workspace/dashboard.token` the dashboard's write token, while it runs
- `workspace/published/` posts, once publishing is enabled

## Letting it use the Mac

Off by default. With `[desktop] enabled = true` the agent may use a few Mac apps while you are away:
the Mac counts as free after `idle_minutes` without keyboard or mouse input, when the screen is not
locked, and inside `hours` if you set them. The moment input that the agent did not generate shows up,
it stops touching the Mac and goes back to the web for another `idle_minutes`.

It never aims at pixels. It sees the frontmost app's accessibility tree as a numbered list of elements
and picks by number: `app` brings an allowed app to the front, `look` re-reads the screen, `click`,
`type`, and `hotkey` act on it. The policy refuses anything else: apps outside `allowed_apps`, typing
into password fields or into apps that are not allowed, shortcuts outside `allowed_hotkeys`, and a
hard-coded never list (app switching, quitting, Spotlight, logout, screenshots, power).

At the end of every episode, if the Mac is free, the agent also types its journal entry into the first
app on `allowed_apps` (TextEdit by default), so you find what it learned on the screen; it never saves
or closes anything. That is a fixed routine, because the local model does not reliably pick up desktop
actions on its own.

`dry_run = true` (the default when enabled) validates and logs every desktop action without performing
it, so you can watch what it would do in the dashboard first. `backend = "fake"` runs the same loop
against an in-memory TextEdit and Calculator, which is how the tests and offline dry runs work.

The real backend needs the pyobjc extras (`.venv/bin/pip install -e ".[desktop]"`) and two macOS
permissions: Accessibility (reading the tree, clicking, typing) and Screen Recording (pictures for
the dashboard). Grant both in System Settings > Privacy & Security to the Python app bundle the venv
runs, normally `/Library/Frameworks/Python.framework/Versions/3.13/Resources/Python.app`: press the
`+` button, then Cmd+Shift+G in the file dialog and paste that path. When you start the bot from a
terminal instead of launchd, macOS attributes the permission to the terminal app, so grant it there
too for trials. `bot check --desktop` prints what is granted and the exact path to use. After a
Python upgrade the checkbox can look on but be dead; toggle it off and on.

While the bot may use the Mac, the Mac has to stay awake and unlocked; the bot refuses to act
behind the lock screen or a screensaver and never unlocks anything. `pmset -g` shows your sleep
settings; the screensaver and lock delay are in System Settings.

## Running at login

`bot --config ~/bots/<slug>/config.toml install` renders `launchd/bot.plist.template` into a launch
agent `com.rebuzz.bot.<slug>`. It starts at login, restarts after a crash, and stays down after
`bot stop`. `bot --config ... uninstall` removes it; `bot list` shows every installed bot.

## Tests

`.venv/bin/pytest`
