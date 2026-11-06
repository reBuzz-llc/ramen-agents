---
published: false
---

# Awesome lists: entries and PR texts (for the owner; not published)

Prepared 2026-11-06 from each list's own README and contributing rules. **Nothing here has been submitted:** the owner
opens each PR (or issue) by hand, one a day, from the reBuzz-llc account. Re-read each list's rules first; they change.

The one-line description used everywhere (under 200 characters, no superlatives):

> Free AI agent team for a small business: finds leads, drafts first emails and researches pricing on free LLM API tiers only, with a Validator that checks every write.

| List | Stars | Where | Ready? |
|---|---|---|---|
| [e2b-dev/awesome-ai-agents](https://github.com/e2b-dev/awesome-ai-agents) | 30.8k | Open-source projects, alphabetical | Yes |
| [slavakurilyak/awesome-ai-agents](https://github.com/slavakurilyak/awesome-ai-agents) | 2.9k | Submission issue (preferred) | Yes |
| [kyrolabs/awesome-agents](https://github.com/kyrolabs/awesome-agents) | 3.0k | Automation, at the bottom | After some traction (see note) |
| [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted-data) | 1.2k (data repo) | `software/ramen-agents.yml` | Not before **2027-03-07** |
| [Shubhamsaboo/awesome-llm-apps](https://github.com/Shubhamsaboo/awesome-llm-apps) | 144k | — | Not a fit (see note) |

---

## 1. e2b-dev/awesome-ai-agents

**Rule:** "Create a pull request or fill in this form. Please keep the alphabetical order and in the correct category."
This list is for agents and assistants (SDKs and frameworks go to their other list), which fits ramen-agents.

**Where:** README.md, under `# Open-source projects`, between `## [Questflow]` and `## [React Agent]` (alphabetical,
case-insensitive).

**Entry:**

```markdown
## [ramen-agents](https://github.com/reBuzz-llc/ramen-agents)
Free AI agent team for a small business, on free LLM API tiers only

<details>

### Category
Productivity, Multi-agent, Sales

### Description
- Seven agents for a small company's daily work: a lead finder, a lead enricher, an outreach writer, a research analyst, a package designer, a scout for free tools and a CEO agent that steers them.
- Runs only on free LLM API tiers (Groq, Gemini, Z.ai, Ollama Cloud and others) behind one OpenAI-compatible chain, and keyless web search; no step needs a card.
- A Validator checks every write in code before it reaches the board: sources required, repeats and invented figures refused.
- A hard fence: no agent can create an account, spend money, send an email or collect personal data.
- A local dashboard shows the agents as a pixel world; a ten-minute demo runs with no key and no network.

### Links
- [GitHub](https://github.com/reBuzz-llc/ramen-agents)
- [Docs](https://rebuzz-llc.github.io/ramen-agents/)

</details>
```

**PR title:** `Add ramen-agents`

**PR text:**

```text
Adds ramen-agents (Apache-2.0) under Open-source projects, in alphabetical order.

It is a team of seven agents for a small business's daily work (finding leads, drafting first emails, researching
pricing), built to run only on free LLM API tiers and keyless search, with a Validator that checks every write and a
fence in code (no accounts, no spending, no personal data). We run it every day at our own small agency.

Repo: https://github.com/reBuzz-llc/ramen-agents
Docs: https://rebuzz-llc.github.io/ramen-agents/
```

---

## 2. slavakurilyak/awesome-ai-agents

**Rule (CONTRIBUTING.md):** a public repository with a substantive, non-automated commit in the last six months; no
license or star minimum. **A submission issue is the preferred path** ("issues are the preferred path for founders");
a PR must edit `awesome-agents.json`, not the README.

**Open:** https://github.com/slavakurilyak/awesome-ai-agents/issues/new?template=project-submission.yml

**Fields:**

- **Project name:** ramen-agents
- **Description:** Free AI agent team for a small business: finds leads, drafts first emails and researches pricing on free LLM API tiers only, with a Validator that checks every write.
- **Repository:** https://github.com/reBuzz-llc/ramen-agents
- **Recent commit evidence:** the `main`, `engine` and `fleet` branches have had commits in November 2026 (link the newest commit on `main` when you open the issue).
- **How people use it:** clone the engine branch and run `bot demo` for a ten-minute demo with no key; the full setup runs the agents on your own machine on schedules, with a local dashboard that shows each agent's current action. The agents search the web, read pages, write leads, notes and draft emails to a board, and each write passes a Validator first. They cannot create accounts, spend money, send email or record personal data.
- **Suggested category:** AI Agents (also Development Frameworks).
- **Note:** the repository is new (public since November 2026), with little outside usage yet. We run it daily at our own agency.

---

## 3. kyrolabs/awesome-agents

**Rule (CONTRIBUTING.md):** open source, maintained, English, agent-related; **"brand new repo without demonstrated
traction"** and **"brand new user"** PRs are closed automatically. Add at the **bottom** of the right section; a PR,
not an issue.

**When:** after the repository has some history and outside stars (a few weeks after the Show HN), not on day one.

**Where:** `## Automation` (above `### Browser`), as the last item.

**Entry:**

```markdown
- [ramen-agents](https://github.com/reBuzz-llc/ramen-agents): A free AI agent team for a small business that finds leads, drafts first emails and researches pricing on free LLM API tiers only, with a Validator that checks every write and a fence in code (no accounts, no spending, no personal data). ![GitHub Repo stars](https://img.shields.io/github/stars/reBuzz-llc/ramen-agents?style=social)
```

**PR title:** `Add ramen-agents to Automation`

**PR text:**

```text
Adds ramen-agents at the bottom of Automation.

Open source (Apache-2.0), maintained (we run it daily), English. It is an agent team for a small business's daily
work that runs only on free LLM API tiers, with a Validator that checks each write and a hard fence in code.

Repo: https://github.com/reBuzz-llc/ramen-agents
```

---

## 4. awesome-selfhosted (later)

**Rule:** "first release more than four months old", counted from a tagged release. With v0.1.0 tagged on
2026-11-06, the earliest submission is **2027-03-07**. Submissions go to the data repository as one YAML file
(`software/<name>.yml`); check the current schema in its CONTRIBUTING.md then. The draft:

```yaml
name: "ramen-agents"
website_url: "https://rebuzz-llc.github.io/ramen-agents/"
source_code_url: "https://github.com/reBuzz-llc/ramen-agents"
description: "Team of AI agents for a small business that finds leads, drafts first emails and researches pricing, on free LLM API tiers only."
licenses:
  - Apache-2.0
platforms:
  - Python
tags:
  - Automation
```

---

## 5. Shubhamsaboo/awesome-llm-apps: not a fit

Every entry there is a template whose code lives inside that repository (`always_on_agents/...`,
`advanced_ai_agents/...`); it does not list outside projects. Contributing would mean writing a small ramen-style
template into their repo, which is a separate piece of work, not a listing.
