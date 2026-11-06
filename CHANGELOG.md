# Changelog

All notable changes to ramen-agents. Dates are when a change reached the public branches. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-11-06

The first release: the agent team we run every day at our own small agency, opened under Apache-2.0. Four branches:
`engine` (the agent runtime and the `bot` CLI), `fleet` (the team, the Validator and the dashboard), `portal` (a team
portal for the leads board) and `main` (the README and the docs site).

### Added

- **A ten-minute demo with no key and no network:** `bot new NAME --fake` and `bot demo`, with a heuristic model and
  eight bundled pages, including the login page the fence refuses.
- **Seven agents:** Lead Gen, Lead Enricher, Outreach Writer, Research Analyst, Package Designer, Scout and The CEO,
  each with a persona, a schedule and a handbook.
- **One shared free-tier chain:** every OpenAI-compatible free tier behind one call, with per-provider token and
  request limits (`tokens_per_day`, `tokens_per_month`, `reasoning_effort`, `max_tokens`), a shared call ledger, and
  provider health from the last good and failed call. Keyless search first, free-allowance search APIs as backups.
- **The Validator:** a write gate that checks every lead, task, note and package before it is written, and a sweep
  that flags what slipped through. Its rules are documented one by one in `docs/validator-rules.md`.
- **The fence, in code:** no account creation, no spending, no sending, no personal data. `FENCE.md` names the file
  that enforces each rule.
- **Calls that count:** repeated searches and pages are refused for the day, agents rest when they have nothing to do
  (`idle_when_empty`, `day_block_rest`), and a crash in the run loop is logged once and does not stop the bot.
- **Leads:** finding a business by exact name or website domain, businesses without a website via their listing page,
  a three-line pain point from an observed gap, email checks with free verification APIs, WhatsApp links from printed
  numbers, and drafts paired with the package email. No send step: people send.
- **The dashboard:** a pixel world where each agent works at its own desk and its screen shows what it is doing, plus
  the work plan, the lead pipeline, the free-tier allowance view and a health banner.
- **Setup with your AI agent:** an ordered checklist and a check that names what is missing and where to get it;
  `scripts/create_leads_board.py` for the Leads board; `disable-bot.sh` and `enable-bot.sh`.
- **The team portal (`portal` branch):** a leads board, a To-do page, packages and "what we have" pages, Google
  sign-in of its own, sign-in codes for outages, files that know their store, and a batched rebuild loader.
- **Docs site** for GitHub Pages: one page per question, with FAQ and software schema, a sitemap and `llms.txt`.
- CI for the Validator's tests and the dashboard's type check and lint; Apache-2.0 licence and NOTICE; contributing
  guide, code of conduct, issue templates and citation file.

### Known limits

- The always-on setup (launchd jobs) is written for macOS. Linux should work with cron or systemd; Windows is untested.
- Free tiers change without notice; a provider can stop answering, and the chain moves on.
- Drafts still need a person: in our own sample, about one in five passed every check unedited.

[Unreleased]: https://github.com/reBuzz-llc/ramen-agents/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/reBuzz-llc/ramen-agents/releases/tag/v0.1.0
