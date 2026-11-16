# Setup on a new Mac

Three commands, then watch the first day. Everything here is free and needs no account except the one model key you
choose (one is enough). macOS only for now: the agents are kept alive by launch agents.

## 1. Clone this branch to `~/bots`

```sh
git clone -b fleet -o starter https://github.com/reBuzz-llc/ramen-agents ~/bots   # the folder must be ~/bots
cd ~/bots
```

The clone names the starter `starter`, not `origin`, so nothing of yours can be pushed back into it by accident.

## 2. Install

```sh
sh scripts/install.sh
```

It checks and installs, in order, one line per step: the Xcode command line tools and Homebrew (it stops and prints
the one command to run when one is missing), Python 3.11+ and Node.js 20+, the engine (cloned to `~/Projects/bot`,
with its Python environment and the agents' browser), this folder's private keys folder and the board's own keys, the
keyless search engine (SearXNG) and the dashboard. Run it again any time: a step that is done says `ok` and changes
nothing. It never asks for a key, never signs in to anything and never edits a tracked file.

## 3. Your family

```sh
sh scripts/setup.sh
```

A few questions: your company's name, what you sell, who buys it, where they are, your name for the sign-off, your
own domain and, if you like, your direction for the agents in one sentence. The answers go to
`common-data/local/family.toml`, which git ignores, so updating never touches them. Every card reads them.

Then it offers to add a free model key (`sh scripts/add-key.sh gemini` says where the key is made, reads it without
showing it and tests it), asks which optional members to start, starts the family and opens the dashboard at
http://127.0.0.1:3000.

Run it again to change an answer (the current one is the default), or use the dashboard's first-run page
(http://127.0.0.1:3000/setup). For an AI coding agent or a second Mac: write the file and run
`sh scripts/setup.sh --answers <file>`; `--no-start` saves the answers without starting anything.

## 4. Watch the first day

On the dashboard each member sits at its desk with a screen showing what it is doing. Within the hour Lead Gen lists
its first leads on the Leads board (`/boards/leads`). Fewer than 1 in 5 of its actions refused is healthy (the Work
plan page shows the share). Stop a member with its Stop button; the others are told and plan around it.

`sh scripts/check-setup.sh` (or `python3 scripts/setup-check.py`) says what is still missing, one line each, and where
to get it.

## Optional

- **More model keys:** `sh scripts/add-key.sh groq` (or `zai`, `mistral`, `openrouter`, `ollama-cloud`, `speka`). More
  keys mean more fallbacks when one provider is busy. Limits and what was measured: [docs/free-tiers.md](docs/free-tiers.md).
- **Email checks before a lead is listed:** `sh scripts/add-key.sh quickemailverification` (and `sniffmail`).
- **A local model as the last resort:** install [Ollama](https://ollama.com/download), then `ollama pull qwen2.5:7b`.
- **More of your own words:** your answers cover who you are; to say more (case studies, rates, a "What we have"
  page), drop text files in `the-ceo/raw/`. To change a setting, put it in `<member>/config.local.toml` or
  `common-data/configs/local.toml` (both git-ignored; the value there wins). See [docs/your-family.md](docs/your-family.md).
- **Reach it from your phone or another computer:** [docs/remote-access.md](docs/remote-access.md).
- **A hosted team portal instead of the local board:** [docs/advanced.md](docs/advanced.md).

## Updating

```sh
sh scripts/update.sh
```

It pulls both folders, first moving any edit you made to a tracked file into the git-ignored overlays (so the pull
never meets a conflict), then reinstalls what changed, restarts the dashboard and your members and runs the setup
check. It prints everything it moved.

On a checkout from before `update.sh` existed, run it once from the starter:
`cd ~/bots && git fetch starter && git show starter/fleet:scripts/update.sh | sh`.

## Your own git remotes

Once the family is yours, give each folder its own private repository:

```sh
cd ~/bots && git remote add origin <your private fleet repository> && git push -u origin fleet
cd ~/Projects/bot && git remote add origin <your private engine repository> && git push -u origin engine
```

`sh scripts/push-all.sh` then pushes both, and `sh scripts/update.sh` still takes improvements from `starter`.

Not in git, so back them up yourself: `common-data/keys/`, `common-data/local/` (your answers and overlays),
`common-data/local-board.sqlite3` (the boards), each member's `workspace/` (its memory) and `the-ceo/raw/`.
