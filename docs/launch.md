---
published: false
---

# Launch checklist (for the owner; not published on the docs site)

Everything here is done by hand, by a person, once the repository is public. No agent posts, submits or signs up for
any of it.

## 1. GitHub settings (10 minutes)

- [ ] **Settings → General → Repository name:** `ramen-agents` (done).
- [ ] **About (⚙ next to "About" on the repo page):**
  - Description: `Free AI agents for startups: an open-source agent family that runs on free tiers and keyless search, with a hard fence (no accounts, no spending, no personal data).`
  - Website: `https://rebuzz-llc.github.io/ramen-agents/`
  - Topics: `ai-agents` `multi-agent` `free-tier` `startups` `agent-framework` `lead-generation` `llm` `autonomous-agents` `open-source` `python` `notion` `searxng` `ollama` `agent-safety` `bootstrapping` `small-business` `research-agent` `local-first` `founders` `prompt-injection-defense`
- [ ] **Settings → General → Social preview:** upload `docs/assets/og.png`.
- [ ] **Settings → General → Features:** Discussions on; Wiki off.
- [ ] **Settings → Pages:** Deploy from a branch → `main` → `/docs`. The site appears at `https://rebuzz-llc.github.io/ramen-agents/`.
- [ ] **Settings → Code security:** Private vulnerability reporting on (CONTRIBUTING.md and the issue template point to it).
- [ ] **Default branch:** `main` (the README lives there).
- [ ] **Visibility:** Settings → General → Danger zone → Change visibility → Public. Last, after reading the README.

## 2. Day one

- [ ] **Discussions:** open and pin "Start here: what are you building?". Ask people to share what they run it for.
- [ ] **Release:** create `v0.1.0` from the `engine` branch, with the CHANGELOG entry as notes.
- [ ] **Search engines:** add the docs site to Google Search Console and Bing Webmaster Tools, and submit
  `https://rebuzz-llc.github.io/ramen-agents/sitemap.xml`.
- [ ] **PyPI:** reserve the name by publishing `ramen-agents` 0.1.0 from the engine branch
  (`python -m build && twine upload dist/*`). This needs your PyPI account; nothing in the repo holds the token.

## 3. Show it to people (one a day, not all at once)

- [ ] **Show HN** (Hacker News). Title draft: `Show HN: Ramen-agents – free-tier AI agents for founders with no budget`.
  First comment draft: what it is in two lines, the ten-minute no-key quickstart, the fence, and one honest
  limitation (macOS for the always-on setup).
- [ ] **Product Hunt.** Tagline draft: `A small team of AI agents that runs on free tiers.`
- [ ] **Awesome lists:** a pull request to each, one line in their format: awesome-ai-agents, awesome-llm-apps,
  awesome-selfhosted (if it fits their rules), awesome-python (agents section).
- [ ] **Dev.to / Hashnode:** cross-post the family's best blog posts (the Research Analyst's findings), with a
  canonical link back to the original and one line about ramen-agents at the end.
- [ ] **Reddit:** r/SideProject and r/LocalLLaMA (the local-model angle). Read each subreddit's self-promotion rule first.

## 4. After a week

- [ ] Read every issue and discussion; answer the first ten within a day.
- [ ] Note the three questions people ask most, and add each as a docs page with the question as its title.
