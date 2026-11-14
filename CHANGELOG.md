# Changelog

All notable changes to ramen-agents. Dates are when a change reached the public branches. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

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

[Unreleased]: https://github.com/reBuzz-llc/ramen-agents/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/reBuzz-llc/ramen-agents/releases/tag/v0.1.0
