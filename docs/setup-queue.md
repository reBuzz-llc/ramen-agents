# Setup queue

The setup as a list to work through in order, by hand or with an AI coding agent (Claude Code, Codex, Cursor and the
like; it starts at [AGENTS.md](../AGENTS.md)). After every step, run:

```sh
python3 scripts/setup-check.py
```

It prints what is still missing, one line each, with where to get it, and exits 0 when nothing is. It changes nothing
and calls nothing on the internet (add `--probe` to test each key with one read-only request).

**Accounts and keys are always yours to make.** No agent, the ones in this repository or the one helping you set it
up, signs up for anything or creates a key. Every key below links to the page where you make it yourself.

## 1. Install (macOS)

- [ ] Clone this branch to `~/bots`: `git clone -b fleet -o starter https://github.com/reBuzz-llc/ramen-agents ~/bots`
- [ ] `cd ~/bots && sh scripts/install.sh`. Every line ends `ok` or `done`; a `STOP` line names the one command to
      run (the Xcode command line tools and Homebrew ask for your password), then run it again.

## 2. Your family

- [ ] `sh scripts/setup.sh`: your company, what you sell, who buys it, where, your sign-off name, your own domain, your
      direction. Saved to `common-data/local/family.toml` (git-ignored). An agent writes that file from your answers
      and runs `sh scripts/setup.sh --answers common-data/local/family.toml`.

## 3. One model key (more are optional)

Each key is one file, `common-data/keys/<name>.key`, written by `sh scripts/add-key.sh <name>`, which reads it without
showing it and tests it. Any subset works; more keys mean more fallbacks. Limits and what we measured:
[free-tiers.md](free-tiers.md).

- [ ] `gemini`: Google AI Studio, https://aistudio.google.com/apikey
- [ ] `groq`: Groq, https://console.groq.com/keys
- [ ] `zai`: Z.ai, https://z.ai (the flash models are free)
- [ ] `openrouter`: OpenRouter, https://openrouter.ai/keys (free models only)
- [ ] Optional: `quickemailverification` (https://quickemailverification.com) and `sniffmail` (https://sniffmail.io),
      so Lead Gen checks an email before listing it.

## 4. Start

- [ ] `sh scripts/setup.sh` starts the dashboard, search, the Validator and the members you chose (The CEO, Lead Gen
      and the Package Designer by default), and opens http://127.0.0.1:3000.
- [ ] `python3 scripts/setup-check.py` prints `Nothing is missing.`
- [ ] **What "working" looks like:** within the hour the dashboard shows Lead Gen *working*, its screen lists the pages
      it opens and the searches it runs, and its first leads reach the Leads board (`/boards/leads`). Fewer than 1 in
      5 of its actions refused is healthy (the Work plan page shows the share). Watch it for a day.

## 5. Optional

- [ ] Ollama with `ollama pull qwen2.5:7b`, the last resort when no provider answers (https://ollama.com/download).
- [ ] Reach the dashboard from your phone: [remote-access.md](remote-access.md).
- [ ] A weekly write-up of what the family did, every Sunday at 21:00, with no business, person or place named: copy
      `common-data/configs/family-week.example.toml` to `family-week.toml`, add your own places and people, then
      `sh scripts/install-launchd.sh family-week`. It lands in `common-data/family-weeks/<Sunday>.md`.
- [ ] A hosted team portal instead of the local board: [advanced.md](advanced.md).
