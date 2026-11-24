# ramen-agents

![15 seconds of the dashboard with example data: a pixel office where each agent works at its own desk, its screen showing what it is doing right now, a close-up of whoever acts and a ticker of the day's numbers along the bottom](docs/assets/world.gif)

**What it is:** a free AI agent team for a small business: it finds leads, prices service packages with a ready-to-send email for each, and a dashboard watches it work; your team sends the emails.<br>
**Who it is for:** a founder or a small agency with a laptop and big plans: the team works while you build the business.<br>
**What it costs:** $0 in model fees on the default free tiers, with keyless search; ramen-agents itself never asks for a card.<br>
**Running in production since late September 2026:** 800+ leads found by the agents.

ramen-agents gives you a lead finder, a research analyst, a package designer, a scout for free tools and a CEO agent that
steers them, plus a Validator that checks every write and a local dashboard. No agent can create an account, spend
money, or collect personal data beyond a business's public contact: that fence is in the code, not in a prompt.

[Try it in 10 minutes](#try-it-in-10-minutes-no-key) · [Run it for real](#run-it-for-real) · [Set up with your AI agent](#set-up-with-your-ai-agent) · [We set it up for you](https://rebuzz-llc.github.io/ramen-agents/set-up-for-you.html) · [The fence](FENCE.md) · [FAQ](#faq) · [The brochure (PDF)](docs/brochure.pdf) · [Docs](https://rebuzz-llc.github.io/ramen-agents/) · Apache-2.0

> **Want it set up for you?** We install ramen-agents on your Mac, set the agents up for your business and start the
> first run with you. The software stays free; the setup is a paid service.
> [Message us on WhatsApp](https://wa.me/15163518016) and ask for a quote:
> [how it goes](https://rebuzz-llc.github.io/ramen-agents/set-up-for-you.html).

---

## Try it in 10 minutes (no key)

You need Python 3.11 or newer. Nothing here needs an account or a key. The clone and install use the network; the demo
itself runs with none: the agent thinks with a built-in heuristic model and reads a bundled set of eight local pages.

```sh
git clone -b engine https://github.com/reBuzz-llc/ramen-agents ramen-engine
cd ramen-engine
python3 -m venv .venv && . .venv/bin/activate   # keeps the install inside this folder
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

## Why this exists

*(A note from the founder: edit freely.)*

Young people starting out have time, a laptop and the open web. That is enough.
ramen-agents is built for them: a small team of agents that does the steady, daily work of an early company (finding
businesses that need you, reading what the market charges, keeping notes with sources, writing the email your team sends), and
does it on the free tiers that model providers and search engines already give away. The name comes from "ramen
profitable": living on ramen while the company finds its feet.

We built it for our own small agency and run it every day. It is opinionated about one thing above all: an agent that
works for you must never sign up for anything, spend anything, or take data that isn't a business's public contact.
Freedom to explore the web, with a fence you can read.

## The family

| Agent | What it does | Where its work goes |
|---|---|---|
| **The CEO** | Sets what the family works on, decides which package fits each lead, writes one clear task a day for the human team | The Tasks board on your dashboard, messages to the others |
| **Lead Gen** | Finds small businesses with a gap you fix (no online ordering, an outdated site, no website) and a published business email or WhatsApp | The Leads board on your dashboard |
| **Package Designer** | Reads what comparable agencies sell and charge, and turns it into priced service packages | Packages handed to The CEO, then the Packages board |
| **Research Analyst** | Answers one research question at a time from public pages, with a source for every note | Findings posts |
| **Scout** | Finds free, card-free tools and model providers, and watches their terms | A list the owner reviews |
| **Validator** | Checks every write against the owner's rules before and after it reaches a board | Refusals, flags, a weekly results digest |
| **Dashboard** | A local web app: who is running, today's scoreboard, refusals, lead results, and the Leads, Tasks and Packages boards | `http://127.0.0.1:3000` |

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

The agents run on a single shared chain of free tiers, tried in order:

- **Models:** Z.ai (GLM-4.5 Flash), Google Gemini, Groq and OpenRouter's free models. One key is enough to start, and a
  provider without a key is simply skipped. No local model is installed; you can add one yourself.
- **Search:** a local SearXNG instance, DuckDuckGo through its MCP server, and FreeSerp's keyless index. No paid search
  API is needed.
- **Budget:** the default chain uses free tiers. A paid provider joins only if you add it by hand, and ramen-agents
  itself never asks for a card. If you link billing on a provider's own account, it can charge you. When a provider
  says it is out for now, the next one answers. If every provider is out, the agent rests until one is back.

## Run it for real

On a Mac (macOS only for now; the agents are kept alive by launch agents), three commands:

```sh
git clone -b fleet -o starter https://github.com/reBuzz-llc/ramen-agents ~/bots && cd ~/bots
sh scripts/install.sh     # everything it needs, checked and installed; safe to run again
sh scripts/setup.sh       # a few questions and one free model key, then the family starts
```

`install.sh` checks or installs, one line per step, the Xcode command line tools and Homebrew (it stops and prints the
command when one is missing), Python 3.11+ and Node.js 20+, the engine (cloned to `~/Projects/bot`), keyless search
(SearXNG) and the dashboard. It never asks for a key and never signs in to anything.

`setup.sh` asks who you are and who you sell to (your company, what you sell, who buys it, where), keeps the answers in
`common-data/local/family.toml` (out of git, so updates never touch them), helps you add one free model key with
`sh scripts/add-key.sh zai`, starts the members you choose and opens the dashboard at http://127.0.0.1:3000. The
same questions are on the dashboard's first-run page.

Your leads, tasks and packages live on **the local board**: one file on your Mac, shown on the dashboard's Leads, Tasks
and Packages pages, where you sort, filter, edit and import or export CSV. The board needs no account; real agents need one free provider account, for a key you create
yourself. Start with the default
members, watch the first day on the dashboard, then add the rest. The full walk-through, with what each step does:
[SETUP.md on the fleet branch](https://github.com/reBuzz-llc/ramen-agents/blob/fleet/SETUP.md).

Optional: [reach the dashboard from your phone or another computer](https://github.com/reBuzz-llc/ramen-agents/blob/fleet/docs/remote-access.md)
with Tailscale (your own account and your choice; check its plan's terms), or
[a hosted team portal instead of the local board](https://github.com/reBuzz-llc/ramen-agents/blob/fleet/docs/advanced.md).

### Updating

```sh
cd ~/bots && sh scripts/update.sh
```

It takes the newest version of both folders from the starter. An edit you made to a tracked file is moved first to the
git-ignored files where your own values live, and named, so the pull never meets a conflict; then it reinstalls what
changed and restarts what was running. On a checkout from before `update.sh` existed, run it once from the starter:

```sh
cd ~/bots && git fetch starter && git show starter/fleet:scripts/update.sh | sh
```

## Set up with your AI agent

An AI coding agent (Claude Code, Codex, Cursor and the like) can do the setup with you. Clone the `fleet` branch to
`~/bots`, open your agent there, and tell it to read
[AGENTS.md](https://github.com/reBuzz-llc/ramen-agents/blob/fleet/AGENTS.md). It runs the three commands, asks you the
setup questions and writes your answers, and runs `python3 scripts/setup-check.py` to see what is still missing. It
never creates an account or a key for you: you make the one key yourself, at the page `add-key.sh` names.

### Finish setup and stay up to date with one prompt

Paste this prompt into your code agent in `~/bots` (any agent that can run shell commands). It finishes setup, updates
ramen-agents and tells you what is new, from the starter's own update notes. Run it once after cloning, then once a
month.

```text
You are helping me run ramen-agents on this Mac: the family is in ~/bots and the engine in ~/Projects/bot.
Work in ~/bots. Read AGENTS.md first and keep to its rules.

Never: create an account, sign up, sign in, pay, start a trial or add a card. Never print, read back, log or
commit a key, and never ask me to paste one anywhere but `sh scripts/add-key.sh <name>`, which I run myself.
Never edit a tracked file to set a value, start a member that has a STOP file, or delete anything in
common-data/keys or common-data/local. Suggest a paid provider only after setup is done, and only if I ask.

1. Finish setup. Run `python3 scripts/setup-check.py`. Take each missing line in order: say what it is, then do
   it or walk me through it. For a key, give me its page from common-data/providers.json; I make the key there
   and run `sh scripts/add-key.sh <name>`. Run the check again until it exits 0. Name the optional lines once.
2. Update. First run `grep -q -- --check scripts/update.sh`. If it fails, this copy is older and would ignore
   --check, so run each update command from the starter instead: `git fetch starter && git show
   starter/fleet:scripts/update.sh | sh -s -- --check`, then the same without `--check`. If it succeeds, run
   `sh scripts/update.sh --check`, then `sh scripts/update.sh`. Either way, show me what --check says would
   change before you run the update.
   Exit 0: updated. Exit 2: updated, but something is newly missing (new_missing in
   common-data/local/last-update.json). Wait a minute and run `python3 scripts/setup-check.py`: a line left by a
   service that was still starting will be gone. If a line stays and docs/updates.json names a step for it, walk me
   through it; if not, or I say no, run `sh scripts/update.sh --rollback`. Exit 1: show me what it printed, and run
   `sh scripts/update.sh --rollback` only if it says to. Do not reset, check out or stash with git yourself.
3. Tell me what is new. Read common-data/local/last-update.json. Then run
   `git diff <fleet.before> <fleet.after> -- docs/updates.json` with the fleet.before and fleet.after values from
   that file, and read only the added lines: they are the new entries. Group them: keys and providers
   worth adding, new features, removed things, and steps only I can take, each with its command. Use only these
   entries. If set_aside lists a file, tell me my edit is kept in common-data/local/before-update/ and was not
   put back.
4. Leave a note. Add a dated section to common-data/local/upkeep-notes.md: what you ran, each exit code, the
   versions before and after, what is new, and what is still missing. Then tell me how to run this prompt on the
   1st of each month with your own scheduler, and set that up only if I say yes.
```

## How it compares

| | ramen-agents | Agent frameworks (CrewAI, AutoGen, now Microsoft Agent Framework) | Paid AI SDRs (Artisan, 11x) |
|---|---|---|---|
| **Monthly cost** | $0 in model fees on the default free tiers; keyless search | The framework is open source (MIT); you pay the model provider you choose | A paid subscription |
| **Setup and UI** | Three commands on a Mac; a local dashboard with the Leads, Tasks and Packages boards | You write the agents in code; visual editors are offered too (Crew Studio, AutoGen Studio) | A hosted web platform |
| **Safety guardrails** | A fence in code that no agent can edit (no accounts, no spending, no personal data beyond a business's public contact), and a Validator that checks every write | What you build and configure | Set by the vendor |
| **Data and privacy** | Boards, keys and the agents' memories in files on your Mac; prompts go to the model provider you chose | Runs where you deploy it; prompts go to the model provider you choose | Your leads and messages live on the vendor's platform |
| **Email outreach** | Packages carry a ready-to-send email; your team sends it | Whatever you build | The vendor's agents send the outreach |

ramen-agents is a complete small team you can read end to end, run on free tiers and change by editing plain-English
instruction files. It has a Validator and a hard fence because it was built to run unattended on a real business's
leads, where one invented email or one sign-up would be one too many.

## FAQ

### What is ramen-agents?

ramen-agents is an open-source (Apache-2.0) team of AI agents for a small business: it finds leads, researches the
market and prices service packages on free model tiers, and a Validator checks every write. Each package carries a
ready-to-send email that your team sends. A local dashboard shows the agents working; it is Python and Next.js.

### Who is it for?

ramen-agents is for founders and small agencies who want lead research and package pricing done every day without
doing it by hand. It was built for, and is run every day by, a small agency.

### Can my AI coding agent set it up?

Yes: an AI coding agent such as Claude Code, Codex or Cursor can set up ramen-agents by reading `AGENTS.md` on the
`fleet` branch, running the three setup commands and asking you the setup questions
([Set up with your AI agent](#set-up-with-your-ai-agent)). It never creates accounts or keys: it asks you for each one,
with the link.

### Can someone set it up for me?

Yes: ReBuzz LLC, the company that built ramen-agents and runs it every day, sets it up for you. We install it on your
Mac, set the agents up for your business and start the first run with you. The software stays free and open source;
the setup is a paid service. Message us on WhatsApp (https://wa.me/15163518016) and ask for a quote. See
[We set it up for you](https://rebuzz-llc.github.io/ramen-agents/set-up-for-you.html).

### Does it cost anything?

The software is free, and you pay $0 in model fees on the default free tiers, with keyless search. Free tiers can
change, and if you link billing on a provider's own account, it can charge you. The providers' own pages do not say
whether their free tier needs a card, so read the sign-up page before you add one. When a provider says it is out for
now, the next one answers. If every provider is out, the agent rests until one is back. You need one free model key
to start and a Mac that stays on.

### Which models does it use?

ramen-agents uses a chain of free model tiers, tried in order: Z.ai, Gemini, Groq and OpenRouter's free models. One
key is enough to start, from Z.ai, Groq or OpenRouter, and a provider without a key is skipped. With no key at all, a
member rests and names the command that adds one. The ten-minute demo needs no key.

Three providers left the default chain in November 2026, and you can still add any of them by hand. Mistral says
"Creating API keys and using the API require billing activation and pay-as-you-go." Ollama Cloud is pay per token.
[Speka](https://speka.me/) says "$1 lifetime credit on every account. No credit card required." After that it is pay per
token. A local Ollama model is not installed or used unless you add it yourself.

### Can an agent spend money or sign up for something?

No: a ramen-agents agent cannot spend money, sign up or log in, because it has no action for it, sign-in and sign-up
pages are blocked, and goals about paying or acquiring credentials are refused in code. The Validator also refuses
writes that break the owner's rules. See [FENCE.md](FENCE.md).

### Can I use my own OpenAI or Anthropic key?

Yes, if you add it yourself: the provider chain is a list in a config file and takes any provider with an
OpenAI-compatible API. The default chain is free tiers only, on purpose, and nothing in this repository asks you to add
a paid key.

### Does my data leave my machine?

Yes, your prompts do. Your boards, keys and the agents' memories stay in files on your Mac, but the default setup has no
local model, so every prompt, including the page text an agent read, goes to a provider you chose. A lead's email,
phone and known contact name are masked by default. The mask does not hide a person's name that is on no row yet, an
address spelled out in words, text inside an image, a phone number outside the usual US forms unless a row holds it,
or business names, which stay readable on purpose. Lead Gen's decision calls read pages to find new contacts, so they
run unmasked, only on Z.ai, Groq or OpenRouter. The Validator's reviews of tasks and packages use the same mask, leave
out the names of a task's assignees, and send nothing if the mask cannot run or the board copy that holds the contact
names cannot be read. Before you add a key, read [what each provider says about your prompts](https://rebuzz-llc.github.io/ramen-agents/free-tiers.html#what-each-provider-says-about-your-prompts). Google's
[terms](https://ai.google.dev/gemini-api/terms) for the free Gemini tier say "human reviewers may read, annotate, and
process your API input and output" and "Do not submit sensitive, confidential, or personal information to the Unpaid
Services", so no Gemini key is saved until you say yes.

### Does it need a Mac?

Yes: the full ramen-agents family runs on macOS only for now, because its installer and always-on setup (launch agents,
the dashboard as a service) are built for macOS. The engine and the ten-minute demo need only Python 3.11 or newer.

### How do I update it?

To update ramen-agents, run `sh scripts/update.sh` in `~/bots`. Your own values live in git-ignored files, so the
update never meets an edit of yours; anything it has to move, it names. See [Updating](#updating). To have your code
agent update it each month and tell you what is new, give it
[the one prompt](#finish-setup-and-stay-up-to-date-with-one-prompt).

### How do I add an agent?

To add an agent, run `bot new "Name" --persona explorer --dir ~/bots`, which makes a folder with a config and a
persona; edit the persona in plain English, then `bot --config ~/bots/name/config.toml install` keeps it running.

## Repository layout

`engine/` and `fleet/` are a copy for reading; install from the branch.

This repository has four branches, because the engine and the family are cloned into different folders:

| Branch | Clone to | Contents |
|---|---|---|
| `main` | (read here) | This README, the fence, the licence, contribution guides, the docs site |
| `engine` | `~/Projects/bot` | The `bot` program: the loop, the policy, the tests |
| `fleet` | `~/bots` | The agents' folders, shared settings, the Validator, the dashboard with the local board, the install, setup and update scripts |
| `portal` | anywhere (optional) | A hosted team portal in place of the local board: people take leads and tasks and record what they sent |

Both working branches ship with none of our data: no leads, notes, keys or logs.

## Contributing, licence, citation

Contributions are welcome: see [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). A pull
request that weakens the fence will not be merged.

Licensed under the [Apache License 2.0](LICENSE). If you use ramen-agents in research or writing, cite it with
[CITATION.cff](CITATION.cff).
