# Launch agents

Templates for the background jobs that keep the fleet running on a Mac. `__HOME__`, `__NODE__` and `__SLUG__` are
filled in by `scripts/install-launchd.sh`, which writes the real files to `~/Library/LaunchAgents/` and loads them.

| Template | What it runs |
|---|---|
| `com.ramen-agents.data.SLUG` | one per bot: the bot's data server (its chat and the dashboard's data) |
| `com.ramen-agents.bot-dashboard` | the dashboard webapp on 127.0.0.1:3000 (build it first: `cd ~/bots/webapp && npm ci && npm run build`) |
| `com.ramen-agents.searxng` | the local keyless search the bots use, on 127.0.0.1:8888 |
| `com.ramen-agents.ollama` | the local model server, the last resort when no remote provider answers |
| `com.ramen-agents.validator`, `com.ramen-agents.validator-inbox` | the Validator's six-hourly sweep and ten-minute inbox loop |
| `com.ramen-agents.search-check` | a test search every three hours, with a notification when search returns nothing |
| `com.ramen-agents.candidates-feed` | Lead Gen's daily list of businesses, when a feed is set for the market |
| `com.ramen-agents.provider-watch` | weekly: have the terms of the model providers changed? |

A bot's own run loop is not here: `bot --config ~/bots/<bot>/config.toml install` writes and loads it
(`com.ramen-agents.bot.<slug>`). The bots' own labels take the engine's prefix: `$BOT_LABEL_PREFIX`, else `~/.config/ramen-agents/label-prefix`, else `com.ramen-agents.bot.`.
