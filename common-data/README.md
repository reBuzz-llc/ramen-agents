# Common data

Files every bot on this Mac shares.

| Path | What it is |
|---|---|
| `configs/common.toml`, `configs/web-bots.toml` | settings more than one bot uses; a bot's `config.toml` pulls them in with a top-level `extends`, and its own values win |
| `configs/searxng-settings.yml` | the local search tool's settings; `scripts/setup.sh` copies it into place with a fresh secret |
| `knowledge/` | standing context every bot can search: the target market, the owner's steers, the packages rules, the handbook |
| `family.md` | the root concept every persona opens with |
| `team.json` | the human team tasks may be assigned to (the dashboard's Team page edits it) |
| `denylist.txt` | sites no bot may open |
| `provider-watchlist.md` | pricing and limits pages re-read weekly for changes |
| `botBox/` | the owner's drop folder; only its README is in git |
| `keys/` | secrets, one file per provider (`<name>.key`, chmod 600). Never in git. |
| `shared-state/`, `logs/` | runtime state and logs. Never in git. |

A bot reads its config only when it starts: change a shared value once, then restart the bots that use it
(`sh scripts/restart-bot.sh <slug>`). Paths in configs start with `~/`; the engine expands them.

`~/.config/explorer` is a link to `shared-state/` (made by `scripts/setup.sh`), so the engine's default files -- the
day's model-call ledger, the search pause file -- land here where the dashboard reads them.

To add a provider key: save it as `keys/<provider>.key`, then `sh scripts/check-keys.sh`. Model providers in
`configs/web-bots.toml` whose key file is missing are simply skipped.
