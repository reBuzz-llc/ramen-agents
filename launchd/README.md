# Launch agents

Templates for the background jobs that keep the fleet running on a Mac. `__HOME__`, `__NODE__` and `__SLUG__` are
filled in by `scripts/install-launchd.sh`, which writes the real files to `~/Library/LaunchAgents/` and loads them.

| Template | What it runs |
|---|---|
| `com.rebuzz.data.SLUG` | one per bot: the bot's data server (its chat and the dashboard's data) |
| `com.rebuzz.bot-dashboard` | the dashboard webapp on 127.0.0.1:3000 (build it first: `cd ~/bots/webapp && npm ci && npm run build`) |
| `com.rebuzz.searxng` | the local keyless search the bots use, on 127.0.0.1:8888 |
| `com.rebuzz.ollama` | the local model server, the last resort when no remote provider answers |
| `com.rebuzz.validator`, `com.rebuzz.validator-inbox` | the Validator's six-hourly sweep and ten-minute inbox loop |
| `com.rebuzz.search-check` | a test search every three hours, with a notification when search returns nothing |
| `com.rebuzz.candidates-feed` | Lead Gen's daily list of businesses, when a feed is set for the market |
| `com.rebuzz.provider-watch` | weekly: have the terms of the model providers changed? |

A bot's own run loop is not here: `bot --config ~/bots/<bot>/config.toml install` writes and loads it
(`com.rebuzz.bot.<slug>`). The `com.rebuzz.` prefix is the engine's label namespace, not a setting.
