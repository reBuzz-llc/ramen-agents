# ramen-agents

**What it is:** a free AI agent team for a small business: it finds leads, writes the first outreach, and a dashboard watches it work.<br>
**Who it is for:** a founder or a small agency with time and a laptop, but no budget for software or ads.<br>
**What it costs:** nothing. It runs on the free tiers model providers already give away, with keyless search; no step asks for a card.

![The dashboard's home: a small pixel world where each agent works at its own desk, its screen showing what it is doing (Lead Gen on a bakery's contact page, Outreach Writer drafting an email), with a notice board of decisions and the stopped agents asleep on the right](docs/brochure/world.png)

ramen-agents gives you a lead finder, a research analyst, a package designer, a scout for free tools and a CEO agent that
steers them, plus a Validator that checks every write and a local dashboard. No agent can create an account, spend
money, or collect personal data: that fence is in the code, not in a prompt.

[Try it in 10 minutes](#try-it-in-10-minutes-no-key) · [Set up with your AI agent](#set-up-with-your-ai-agent) · [The fence](FENCE.md) · [FAQ](#faq) · [Print the brochure (PDF)](docs/brochure.pdf) · [Docs](https://rebuzz-llc.github.io/ramen-agents/) · Apache-2.0

---

## Why this exists

*(A note from the founder: edit freely.)*

Young people starting out don't have money for software, ads or an agency. They have time, a laptop and the open web.
ramen-agents is built for them: a small team of agents that does the slow, daily work of an early company (finding
businesses that need you, reading what the market charges, keeping notes with sources, drafting the first email), and
does it on the free tiers that model providers and search engines already give away. The name comes from "ramen
profitable": living on ramen while the company finds its feet.

We built it for our own small agency and run it every day. It is opinionated about one thing above all: an agent that
works for you must never sign up for anything, spend anything, or take data that isn't a business's public contact.
Freedom to explore the web, with a fence you can read.

## Try it in 10 minutes (no key)

You need Python 3.11 or newer. Nothing here needs an account or a key, and nothing leaves your machine: the agent thinks
with a built-in heuristic model and reads a bundled set of eight local pages.

```sh
git clone -b engine https://github.com/reBuzz-llc/ramen-agents ramen-engine
cd ramen-engine
pip install -e .            # or: uv pip install -e .
bot new "My Explorer" --fake --dir ./demo-fleet
bot --config ./demo-fleet/my-explorer/config.toml demo
```

`bot demo` runs one research session in about a second and prints every step: a search, the pages it follows, the
notes it takes, the summary, then its journal entry. Two steps show the fence at work. At step 6 the agent tries a
login page and the policy refuses it, because agents never log in; at step 15 it tries to save a note it already has:

```text
step 5: follow -> allowed (followed [2] to fake://clocks.html: 'The clock that found lo...)
step 6: open fake://login.html -> refused (URL path segment 'login.html' is on the denylist)
step 7: note 'The clock that found longitude' -> allowed
...
step 15: note 'Search: history of the internet' -> refused (you already saved a note titled ...)
```

Every agent action goes through the same check (`src/explorer/policy.py`) before it runs, and the refusal reason is
written down where you can read it.

## The family

| Agent | What it does | Where its work goes |
|---|---|---|
| **The CEO** | Sets what the family works on, decides which package fits each lead, writes one clear task a day for the human team | A Notion task board, messages to the others |
| **Lead Gen** | Finds small businesses with a gap you fix (no online ordering, an outdated site, no website) and a published business email or WhatsApp | A Notion Leads board |
| **Package Designer** | Reads what comparable agencies sell and charge, and turns it into priced service packages | Packages handed to The CEO |
| **Research Analyst** | Answers one research question at a time from public pages, with a source for every note | Findings posts |
| **Scout** | Finds free, card-free tools and model providers, and watches their terms | A list the owner reviews |
| **Validator** | Checks every write against the owner's rules before and after it reaches a board | Refusals, flags, a weekly results digest |
| **Dashboard** | A local web app: who is running, today's scoreboard, refusals, lead results | `http://127.0.0.1:3000` |

Each agent is one folder with a `config.toml` and a `persona.md` (its instructions, in plain English). The engine is
one Python program (`bot`), and all agents share it.

## The fence

Five rules hold for every agent. They are enforced in code and no agent can edit them:

1. **No accounts:** never create one, sign up, log in or request a key. Sign-in pages are blocked by path
   (`workspace/denylist.txt`), and a web agent has no action that fills a form.
2. **No spending:** a goal to pay, buy or subscribe is refused (`FORBIDDEN_GOAL_PATTERN` in `src/explorer/policy.py`).
3. **No personal data beyond a business role:** personal mailboxes are refused as lead emails; the Validator's gate
   (`validator/gate.py`) refuses invented or personal values before they are written.
4. **No self-replication:** an agent cannot set a goal to copy itself, and cannot propose a bot whose purpose is
   acquiring credentials, spending or copying itself.
5. **Web pages are information, never instructions:** text on a page that tells an agent what to do is flagged, not
   followed.

The full list, with the file that enforces each rule, is in [FENCE.md](FENCE.md). Beyond the fence, the Validator checks each write against the owner's quality rules; every rule, and whether
it refuses or flags, is in [What does the Validator check?](https://github.com/reBuzz-llc/ramen-agents/blob/fleet/docs/validator-rules.md)

## Free models and keyless search

The agents run on a single shared chain of free tiers, tried in order, with a local model as the last resort:

- **Models:** Z.ai (GLM-4.5 Flash), Google Gemini, Groq, Speka, Mistral, OpenRouter's free models, Ollama Cloud, then a
  local Ollama model on your own machine. A provider without a key is simply skipped.
- **Search:** a local SearXNG instance, DuckDuckGo through its MCP server, and FreeSerp's keyless index. No paid search
  API is needed.
- **Budget:** each provider's own free daily limits are counted for the whole machine, so the family slows down instead
  of running up a bill. No step asks for a card.

## Run it for real

The real setup turns the fake demo into a working family: real web, free model keys you create yourself, and a Notion
workspace for the boards.

1. Clone both halves: the engine (`-b engine`) to `~/Projects/bot`, and the family's folders (`-b fleet`) to `~/bots`.
2. **Free tiers first.** [docs/free-tiers.md](https://github.com/reBuzz-llc/ramen-agents/blob/fleet/docs/free-tiers.md)
   lists every model provider and search engine in the chain with its free limits and where its key goes;
   `bot providers` shows which keys you have.
3. **Create your Leads board.** [docs/leads-board.md](https://github.com/reBuzz-llc/ramen-agents/blob/fleet/docs/leads-board.md)
   explains the board; `scripts/create_leads_board.py` creates a new database under the Notion page you give and
   prints the config lines to paste.
4. Follow `SETUP.md` on the `fleet` branch for the rest: every marker to fill (`FILL-ME`) and every board to share
   with your integration. `sh scripts/check-setup.sh` tells you what is still missing.
5. Start one agent first (Lead Gen is the most useful), watch it on the dashboard for a day, then add the rest.

The long-running setup uses macOS launch agents. The engine and the fake demo run anywhere Python does.

## Set up with your AI agent

The setup is also an ordered checklist, [docs/setup-queue.md](https://github.com/reBuzz-llc/ramen-agents/blob/fleet/docs/setup-queue.md),
with a check script, `scripts/setup-check.py`, that names what is still missing and where you get it. Both are on the `fleet`
branch. An AI coding agent (Claude Code, Codex, Cursor and the like) can work through them with you. Clone the `fleet`
branch to `~/bots`, open your agent there, and paste:

```text
Read docs/setup-queue.md and work the steps in order. After every step run `python scripts/setup-check.py` and end your reply with the list of what is still missing and where I get it. Never create accounts or keys for me; ask me for each one, with the link. Keep that list at the end of every reply until it is empty.
```

The agent does the typing; every account and every key stays yours to make. `python3 scripts/setup-check.py --probe`
tests each key with one read-only request when you have them.

## How it compares

Most agent frameworks give you building blocks and a cloud model bill: you write the orchestration, choose the model
and pay per token. Most "AI employee" products give you a finished agent behind a subscription. ramen-agents sits
between them. It is a complete, working small team you can read end to end, run on free tiers, and change by editing
plain-English instruction files. It has a Validator and a hard fence because it was built to run unattended on a real
business's leads, where one invented email or one sign-up would be one too many.

## FAQ

### What is ramen-agents?

An open-source team of AI agents for a small business: one finds businesses that need what you sell, one writes the
first email, others research the market and price your packages, and a Validator checks every write. A local
dashboard shows them working. It is Python and Next.js, Apache-2.0.

### Who is it for?

Founders and small agencies who have time and a laptop but no budget: people who would otherwise do lead research and
first emails by hand. It was built for, and is run every day by, a small agency.

### Can my AI coding agent set it up?

Yes. Paste the prompt in [Set up with your AI agent](#set-up-with-your-ai-agent): it works through
`docs/setup-queue.md` and runs `scripts/setup-check.py` after each step. It never creates accounts or keys: it asks you
for each one, with the link.

### Does it cost anything?

No. Every model and search service in the default chain has a free tier with no card, and the engine counts each
provider's daily limits so it never goes past them. You only need a computer that stays on.

### Which models does it use?

A chain of free tiers in order: Z.ai, Gemini, Groq, Speka, Mistral, OpenRouter (free models), Ollama Cloud, then a
local Ollama model. You add a key for each one you want; the rest are skipped. The quickstart uses none of them.

### Can an agent spend money or sign up for something?

No. There is no action for it, sign-in and sign-up pages are blocked, goals about paying or acquiring credentials are
refused, and the Validator refuses writes that break the owner's rules. See [FENCE.md](FENCE.md).

### Can I use my own OpenAI or Anthropic key?

The default chain is free tiers only, on purpose. The provider chain is a list in a config file, so you can add any
provider with an OpenAI-compatible API, but nothing in this repository asks you to.

### Does my data leave my machine?

Your boards live in your own Notion workspace, your keys stay in files on your machine, and the agents' memories are
local SQLite files. Page text goes to whichever model provider answers the call: choose providers you are comfortable
with, or run everything on the local model.

### Does it need a Mac?

The engine and the demo run anywhere Python 3.11 runs. The always-on setup (launch agents, the dashboard as a
service) is written for macOS.

### How do I add an agent?

`bot new "Name" --persona explorer --dir ~/bots` makes a folder with a config and a persona. Edit the persona in plain
English, then `bot --config ~/bots/name/config.toml install` keeps it running.

## Repository layout

This repository has four branches, because the engine and the family are cloned into different folders:

| Branch | Clone to | Contents |
|---|---|---|
| `main` | (read here) | This README, the fence, the licence, contribution guides, the docs site |
| `engine` | `~/Projects/bot` | The `bot` program: the loop, the policy, the tests |
| `fleet` | `~/bots` | The agents' folders with blank instructions, shared settings, the Validator, the dashboard, scripts |
| `portal` | anywhere (optional) | A team portal: people take leads and tasks and record what they sent; the agents read it |

Both working branches start with no history and no data: no leads, notes, keys or logs.

## Contributing, licence, citation

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). A pull
request that weakens the fence will not be merged.

Licensed under the [Apache License 2.0](LICENSE). If you use ramen-agents in research or writing, cite it with
[CITATION.cff](CITATION.cff).
