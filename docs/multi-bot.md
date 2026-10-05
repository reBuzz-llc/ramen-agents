# Running several bots with different personas

Owner's intent (2026-09-14): this bot is now named Jobless-Bot. Later there will be more bots,
each with its own persona and its own share of the machine, all running the way this one does
(launchd, supervisor, quiet mode).

**Status, same day, later:** built. `bot new NAME --persona explorer|ceo|researcher --port N` creates
`~/bots/<slug>/` (config, persona.md, workspace); `bot --config ... install` renders
`launchd/bot.plist.template` to `com.rebuzz.bot.<slug>`; `bot list` reads the installed agents.
Personas live in `personas/` and are injected into the system prompt via `agent.persona_file`.
Jobless-Bot was migrated in place with its memory; The CEO (`personas/ceo.md`, Notion tasks as its
output skill, off until configured) was created second. All four changes listed at the bottom are
done; item 4 became `search.py`: a machine-wide pause file (default `~/.config/explorer/search_pause.json`)
plus a chain of keyless engines (marginalia, wikipedia, hn, and `corpus` for the owner's `raw/`
folder; there is no Brave API engine, and Brave in Chromium is opt-in only), so one bot's rate limit
pauses that engine for every bot and searching continues elsewhere. The rest of this document is the
original reasoning; the notes in brackets say where it has since changed.

**Shared configs (later still):** settings every bot shares live in `~/bots/common-data/configs/`:
`common.toml` (all bots) and `web-bots.toml` (the clear-web bots; it extends `common.toml` and holds
the model chain). A bot's `config.toml` names one with a top-level `extends = "../common-data/configs/web-bots.toml"`
(paths relative to the naming file, a list allowed); the bot's own values win, tables merge key by
key, arrays replace. `bot new` writes that line when the parent folder has `common-data/configs`,
leaves out what the shared files already set, copies the denylist only when none is shared, and
always writes `provider = "ollama"` for the Tor researcher. API keys for every bot are in
`~/bots/common-data/keys/<name>.key`.

## What is already per-bot

Everything hangs off one `config.toml`, and every path in it is relative to that file's folder, so a
second bot is mostly a second folder:

- `agent.name`, `agent.bio`, `agent.seed_interests`: the persona. The name goes into the system
  prompt, the chat partner prompt, and the browser user agent.
- `paths.workspace`, `paths.db`, `paths.log`: its memory, journal, screenshots, flags (`STOP`,
  `PAUSE`), and the single-instance lock (`workspace/explorer.pid`), so two bots never collide.
- `dashboard.port`: one dashboard per bot.
- `developer.root`: its own sandbox and upgrade worktree.
- `quiet`: shared behaviour, but each bot can be more or less deferential.

## What is shared, and where bots will compete

- **Ollama.** One server, one model in memory at a time per model name. Two bots on `qwen2.5:7b`
  queue behind each other (Ollama serialises requests per model); two different 7B models means
  ~10 GB resident on a 16 GB Mac mini, which is too much alongside a game. Rule of thumb: bots share
  a model, and quiet mode unloads it when the owner is present.
- **Search engines.** Rate limits are per IP, and one bot already hit Brave's. A second bot doubles the
  problem. Per-bot `policy.pages_per_hour` is the lever now; a second search backend is the fix.
  [Done: keyless engines with a shared pause file, see the status above.]
- **The GPU and the owner.** Quiet mode is per bot but reads the same signals, so all bots go quiet
  together. That is the intended behaviour.

## Resource allocation, the simple version

There is no scheduler. Each bot gets a budget through its own config:

| knob | what it buys |
|---|---|
| `agent.cycle_delay_seconds` | how often it thinks (model calls per hour) |
| `policy.pages_per_hour` | how much it browses (search-engine and site load) |
| `model.provider` / `provider_chain` / `remote_for` | whether it spends free API quota or local GPU |
| `quiet.idle_seconds` | how long after the owner stops before it dares to start |
| launchd `Nice` / `ProcessType` | CPU and I/O priority of the loop itself |

A "lazy" bot: cycle delay 120 s, 20 pages an hour. An "eager" one: 20 s and 60. Both go quiet the
moment the owner touches the Mac.

## What has to change in the code

1. `launchd/` and `scripts/install_launchd.sh` hard-code the label `com.rebuzz.explorer` and the
   paths. Turn the plist into a template rendered from `bot install --name jobless-bot`, so each
   bot gets `com.rebuzz.<name>` with its own config path, logs, and dashboard port.
   [Done as `bot --config ... install` (`fleet.py`), label `com.rebuzz.bot.<slug>`; the install
   scripts are deleted.]
2. `scripts/supervise.sh` takes `EXPLORER_HOME` already; make the config path a parameter too.
3. A `bot ls` (or `bots` command) that lists every installed bot and its heartbeat, reading each
   config's database. Today `bot status` only knows the config it was pointed at.
4. Optional: a shared `search_paused_until` across bots, so when one is rate-limited the others
   stop searching too. Cheapest form: a file under a shared folder both configs point at.

Order: 1 and 2 together (one afternoon), then 3, then 4 only if a second bot actually needs it.
