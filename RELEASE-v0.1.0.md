**ramen-agents** is a free AI agent team for a small business: it finds businesses that need what you sell, drafts the
first email, researches the market, and a dashboard shows it working. It runs on the free tiers model providers already
give away, with keyless search. No step asks for a card.

## What's in it

- **Engine** (`engine` branch): Ramen, the one Python program every agent runs on, with the `bot` CLI. One shared
  chain of free tiers behind one call, with each provider's free limits counted for the whole machine.
- **Fleet** (`fleet` branch): five agents (Lead Gen, Research Analyst, Package Designer, Scout and
  The CEO), each a folder with a plain-English persona. The Validator checks every write before it
  reaches a board.
- **Dashboard:** a pixel world where each agent works at its own desk. The **Decisions box** holds the CEO's proposals,
  roster changes and owner items. **Key providers** shows each key's plan, allowance and specs, with a per-key test.
  It also has Checks, Leads, Personas, Glossary and Reports pages.
- **Portal adapter:** set `[leads] portal_url` in `common.toml` to keep the Leads board on the team portal (`portal`
  branch). Leave it unset and the board stays on Notion.
- **The fence, in code:** no accounts, no spending, no sending, no personal data beyond a business's public contact,
  no self-replication. [FENCE.md](https://github.com/reBuzz-llc/ramen-agents/blob/main/FENCE.md) names the file that
  enforces each rule.

## Free tiers only

The default chain is Z.ai, Gemini, Groq, Speka, Mistral, OpenRouter's free models and Ollama Cloud, then a local Ollama
model. A provider without a key is skipped. Search is keyless (SearXNG, DuckDuckGo, FreeSerp). Nothing in the
repository asks for a paid key.

## Quick start (no key, about 10 minutes)

```sh
git clone -b engine https://github.com/reBuzz-llc/ramen-agents ramen-engine
cd ramen-engine
pip install -e .
bot new "My Explorer" --fake --dir ./demo-fleet
bot --config ./demo-fleet/my-explorer/config.toml demo
```

To set up the real team, clone `fleet` to `~/bots` and follow `docs/setup-queue.md`. You can work through it by hand
or with your AI coding agent. `python scripts/setup-check.py` names what is still missing.

## Known limits

- The always-on setup (launch agents) is written for macOS. The engine and the demo run anywhere Python 3.11 runs.
- Free tiers change without notice. A provider can stop answering, and the chain moves on.
- Drafts still need a person, and there is no send step: people send.
- Page text goes to whichever model provider answers. Choose providers you trust, or use the local model.

Example data only: no real leads, names or keys. Apache-2.0.
