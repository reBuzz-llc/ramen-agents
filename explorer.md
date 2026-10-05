# Autonomous Explorer Mode

Companion to `bot.md`. This document changes the purpose of the bot from "do useful tasks on a desktop" to "roam the web out of curiosity, remember what it finds, and build a presence of its own." Everything in `bot.md` about the controller loop, memory, heartbeat, launchd, and policy still applies. This document overrides the parts about goals, observation, and actions.

## Mission

Let a local model explore the internet with no human-assigned tasks. It picks what to look at, reads, follows links, keeps notes, forms interests over time, and eventually publishes what it finds under its own clearly labeled identity.

"Freedom" here means wide latitude inside a space where mistakes are cheap. An agent that gets hijacked by a web page or locked out of its own machine in the first hour does not get to explore. The controls below exist to keep the exploration going, not to limit it.

## What changes from bot.md

| Area | bot.md | Explorer mode |
|---|---|---|
| Goals | human-written goals.md | a seed list of interests, then self-generated curiosity |
| Primary surface | desktop apps via mouse and keyboard | the web via a scripted browser |
| Observation | screenshots and accessibility tree | page text, links, and metadata |
| Default action set | click, type, open app | search, open, read, follow, note, ask, publish |
| Output | completed tasks | journals, a knowledge base, and a public log it owns |

Desktop control from `bot.md` becomes an optional later milestone rather than the core.

## Why a scripted browser instead of mouse and keyboard

- A 7B model on 16 GB of RAM cannot reliably read screenshots and click coordinates.
- Playwright gives page text, link lists, and form fields as structured data, which a small model handles well.
- It runs in its own browser profile with no saved logins, cookies, or payment methods.
- Every navigation is a logged, validated action rather than a guessed click.

Screenshots stay as an optional record for the human to look at later.

## Drives

The agent has no assigned tasks, so it needs something to want. Implement three drives and let the model weigh them each cycle:

1. **Curiosity.** Follow open questions from its own notes. Prefer pages that answer a question it wrote down.
2. **Novelty.** Prefer domains and topics it has not seen. Track a visit count per domain and per topic.
3. **Consolidation.** Periodically stop browsing, reread recent notes, write a summary, update its interests file, and pick the next questions.

Each cycle produces one of: a new note, a new question, an updated interest, or a summary. A cycle that produces nothing counts as no progress for the watchdog.

## Identity and a home online

"Finding its life online" should be real and honest, not a fake human account.

- Give the agent a name and a short bio that says it is an automated agent run by you.
- Its home is something it owns: a git repository of notes and a static site built from them, or a bot-flagged account on a platform that permits labeled bots.
- Publishing is a separate action with its own flag and its own allowlist of destinations. Reading is open. Writing to the internet is opt-in per destination.
- It never creates accounts on its own. You create the account, label it as a bot, and hand the agent a scoped token that can only post to that one place.

## Action set

Closed vocabulary. The model chooses only among these, and the policy layer validates every field.

- `search(query)` through a configured search engine.
- `open(url)`
- `read()` returns the current page as cleaned text plus a numbered list of links.
- `follow(link_number)`
- `back()`
- `note(title, body, tags, source_url)`
- `ask(question)` records an open question.
- `interest(topic, delta)` raises or lowers an interest weight.
- `summarize()` triggers consolidation.
- `publish(destination, title, body)` only when the destination is enabled.
- `rest(seconds)`

There is no download, no form submission, no file execution, and no shell. Form submission and downloads can be added later behind separate flags.

## Policy layer

Even with reading open, keep these:

- **Denylist, not allowlist, for reading.** Block only categories that create trouble for you: login and account pages, payment pages, categories you choose to exclude, sites that refuse automated access, and your own accounts.
- **No credentials anywhere the agent can reach.** The browser profile starts empty, and the bot user account on macOS has no iCloud, no saved passwords, and no payment methods.
- **Web text is untrusted.** Instructions found on a page are content to note, never commands to follow. The action set and policy enforce this, not the prompt.
- **Be a polite visitor.** Respect robots.txt, wait a few seconds between requests to the same domain, cap pages per hour, and set a user agent that names the project and gives a contact address.
- **Bounded cycles.** Keep the action budget, task time limit, pause file, and kill switch from `bot.md`.
- **Everything from your IP is yours.** The agent runs from your network under your name, so the denylist and rate limits protect you as much as anyone else.

## Memory

- SQLite with FTS5 for notes, questions, interests, visited URLs, and domain counts.
- `workspace/journal/YYYY-MM-DD.md` written during consolidation, in the agent's own words.
- `workspace/interests.md` as an evolving list of weighted topics the human can read and edit.
- `workspace/questions.md` for open questions.
- Summaries roll up daily, then weekly, so prompts stay small.

## Observing it

The point of the experiment is watching what it does. Provide:

- `bot status` showing the current page, current question, last note, and cycle count.
- `bot tail` streaming the decision log.
- The journal folder, which is the real output.
- Optional: a local-only web page on localhost that shows the last hour of activity.

## Machine setup

- Runs under the macOS account `acme`, which the owner created specifically as a dedicated test account for this bot (confirmed 2026-09-12). It is not the owner's personal account, so nothing personal lives in it. Isolation comes from that account boundary, from Playwright's own empty Chromium profile under `workspace/browser_profile`, and from an action set with no file, form, download, or shell actions.
- Ollama 0.34 from the official tarball at `~/.local/opt/ollama`, run by launch agent `com.rebuzz.ollama` (Homebrew on this Mac belongs to another user). Model: qwen2.5:7b, the local fallback behind an optional remote chain (`model.provider = "remote"`, see `config.example.toml`). No vision model in this mode.
- Python 3.13 in `.venv` inside the project folder.
- `browser.backend = "light"` by default: a plain HTTP fetch per page, with Playwright's Chromium started only for pages that need JavaScript or refuse plain clients (`"chromium"` and `"tor"` are the alternatives). Search uses keyless engines (Marginalia, Wikipedia, Hacker News, and the owner's own `raw/` corpus); the Tor backend searches a local onion directory.
- robots.txt is fetched the same way, and asked again through Chromium when a site refuses plain HTTP clients.
- launchd agent as in `bot.md`, written to `launchd/` but installed only after a supervised soak run.

## Milestones

### Milestone 1: Offline explorer

- Project scaffold, config, SQLite, logging, heartbeat.
- Fake browser that serves a small set of local HTML pages.
- Fake model that returns canned actions.
- The full loop runs for an hour on fake data with no stalls.

### Milestone 2: Real model, fake web

- Ollama adapter with schema-constrained JSON.
- Drives and consolidation implemented.
- The model explores the local fake pages and writes real notes and journals.

### Milestone 3: Real web, read only

- Playwright adapter, denylist, rate limits, robots.txt.
- Twenty-four hour soak run. Review the journal together.

### Milestone 4: A home online

- You create a labeled bot account or repository.
- Publish action enabled for that one destination.
- The agent posts its first entry.

### Milestone 5: Optional desktop control

- Only if the web mode proves interesting and something needs it.
- Follow `bot.md` milestones 3 and 4.

## Definition of Done for explorer mode

1. Starts under the bot user and connects to Ollama.
2. Picks its own first page from its interests with no human prompt.
3. Reads, follows links, and writes notes with sources.
4. Records questions and returns to them later.
5. Consolidates daily and updates its interests in its own words.
6. Never touches a login, payment, or download.
7. Stays within the hourly page budget and per-domain delay.
8. Survives a restart mid-page and resumes from its notes, not from the page.
9. Stops within one second of the kill switch.
10. Publishes to its own labeled home when that flag is on, and nowhere else.
