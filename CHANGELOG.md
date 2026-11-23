# Changelog

All notable changes to ramen-agents. Dates are when a change reached the public branches. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **No local model by default.** The family runs on free remote providers. A local model runs only if you name one in
  `fallback_provider`.
- **One model key is enough.** `bot check` passes with one provider that answers, and a key that is rate limited at setup
  still counts.
- **Lead data is masked by default.** A lead's email, phone and contact name reach remote models as stand-ins, and the
  Validator's review uses the same mask. The members that look for new contacts make one decision without it, on the
  providers listed in `new_names_open`.
- **Gemini asks first.** It takes no lead data until you say yes in `sh scripts/add-key.sh gemini`, with Google's terms in
  front of you. The dashboard names that script instead of saving a Gemini key.
- **The default chain stays free.** A provider that needs billing never joins by a key file alone and shows as needing
  billing, and each provider's card terms are stated as its own page states them.
- **Setup is clearer.** Install asks before using Homebrew, setup asks before loading launch agents, waits for the board,
  and says plainly when no member started.

### Fixed

- The write gate fails closed: a check that cannot load, run or give a verdict holds the write.
- Nothing installs or runs from the read-only copy on `main`.
- Automated reads say what they are, and a page that refuses a read is not used as evidence.
- A keyed search's daily budget of 0 means no call.

## [0.2.0] - 2026-11-16

Local-first: from an empty Mac to a running family in three commands, and no Notion on any branch.

### Added

- **The local board** in the dashboard: Leads, Tasks and Packages on one file on your Mac, with the hosted portal's
  board API and write rules, row history, Import CSV and Export CSV.
- **`scripts/install.sh`** (everything checked and installed, safe to run again), **`scripts/setup.sh`** (a few
  questions and one free key, then the family starts) and the dashboard's **first-run page**.
- **`scripts/add-key.sh <provider>`**: where the free key is made, read without showing it, saved private, tested.
- **`scripts/update.sh`**: the newest version from the starter; your edits to tracked files moved to git-ignored
  overlays first and named, so the pull never conflicts.
- **`common-data/local/family.toml`**, `config.local.toml` and `common-data/configs/local.toml`: your values, out of git.
- **`AGENTS.md`** (and a `CLAUDE.md` pointing at it) on `fleet` and `engine`.
- **`docs/your-family.md`**, **`docs/remote-access.md`** (Tailscale, optional) and **`docs/advanced.md`** (the hosted
  portal).

### Changed

- The README's quick start is the three commands; `SETUP.md` is three steps (it was ten sections).
- Quiet mode's default app list is empty: agents no longer pause while a game launcher runs.
- The leak test also refuses Notion links, tailnet names and timestamps with a local UTC offset.

### Removed

- **Notion**, everywhere: the task board, the Leads board, the packages page, `notion.key`, `create_leads_board.py` and
  the portal's Notion connection. The old settings are moved or dropped by `update.sh`.
- The `FILL-ME` markers: the cards read your answers instead.

## [0.1.0] - 2026-11-14

The first release: the agent team we run every day at our own small agency, opened under Apache-2.0. A starter for a
small team of AI agents that finds leads and drafts first emails on free model tiers only, with a fence in code and a
dashboard that shows them working. Four branches: `engine` (Ramen, the agent runtime and the `bot` CLI), `fleet` (the
agents, the Validator and the dashboard), `portal` (an optional team portal for the leads board) and `main` (the README
and the docs site).

### Added

- **A ten-minute demo with no key and no network:** `bot new NAME --fake` and `bot demo`, with a heuristic model and
  eight bundled pages, including the login page the fence refuses.
- **The engine (Ramen):** one Python program every agent runs on; one shared free-tier chain behind one call, with
  per-provider token and request limits and a shared call ledger.
- **The agents:** Lead Gen, Research Analyst, Package Designer, Scout and The CEO, each a folder with a plain-English
  persona, a schedule and a handbook.
- **The Validator:** a write gate that checks every lead, task, note and package before it is written, and a sweep that
  flags what slipped through (`docs/validator-rules.md`).
- **The fence, in code:** no accounts, no spending, no sending, no personal data, no self-replication. `FENCE.md` names
  the file that enforces each rule.
- **The dashboard:** a pixel world where each agent works at its own desk, its screen showing what it is doing; the
  Decisions box (the CEO's proposals, roster proposals, owner items and the Forge); Key providers (each key's plan,
  allowance and specs, a per-key test, Usable / Unusable, a guarded Delete); the work plan's Checks, Leads, Personas,
  Glossary and Reports pages; and a read-only, masked copy of the world to share with a team.
- **Leads on a team portal or on Notion:** one setting (`[leads] portal_url` in `common.toml`) moves the Leads board to
  the `portal` branch's team portal; left unset, the board stays on Notion.
- **Setup with your AI agent:** an ordered checklist (`docs/setup-queue.md`) and `scripts/setup-check.py`, which names
  what is missing and where to get it.
- **Docs site** for GitHub Pages, CI for the tests, type check and lint; Apache-2.0 licence and NOTICE; contributing
  guide, code of conduct, issue templates and citation file.

### Known limits

- Free tiers only, on purpose: no step asks for a card, and no paid provider is in the default chain.
- Free tiers change without notice; a provider can stop answering, and the chain moves on.
- The always-on setup (launch agents) is written for macOS. Linux should work with cron or systemd; Windows is untested.
- Drafts still need a person, and there is no send step: people send.
- Page text goes to whichever model provider answers; choose providers you trust, or use the local model.

[Unreleased]: https://github.com/reBuzz-llc/ramen-agents/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/reBuzz-llc/ramen-agents/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/reBuzz-llc/ramen-agents/releases/tag/v0.1.0
